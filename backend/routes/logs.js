/**
 * 系统日志（审计轨迹）—— 读取 audit_log 并提供筛选、统计与导出。
 *
 * 为什么要有这一页：Wayne 2026-09-15 参照 GoodJob 的系统日志页提出 —— 登录、改密、
 * 用户/权限组/组织变更、客户归属流转、商机状态、AI 接入变更都会写 audit_log，
 * 但这些记录此前只能在库里看见，界面上没有任何入口。
 *
 * ⚠️ 挂载点刻意**不放在 /api/system/ 下** —— 那个前缀在免登录白名单里
 *    （`/^\/api\/(health|auth\/|system\/)/`），放在那儿等于把全公司的操作日志公开。
 *
 * 权限：`audit.view`，按 Wayne 的口径**只授给系统管理员组**（见 lib/permissions.js）。
 * 界面入口同理：没这个点的人，设置里根本看不到「系统日志」这一项。
 */

const express = require('express');
const db = require('../db/db');
const auth = require('../lib/auth');

const router = express.Router();

/* ---------------------------------------------------------------------------
 * 分类：按 action 前缀归组。新增 action 时如果这里没覆盖，会落到「系统」，
 * 不会丢记录 —— 宁可直接显示，也不要因为漏配而看不见。
 * ------------------------------------------------------------------------- */
const CATEGORIES = [
  { key: 'auth', label: '认证', match: /^(login|logout|password_|profile_)/ },
  { key: 'user', label: '用户', match: /^user_/ },
  { key: 'permission', label: '权限', match: /^permission_group_/ },
  { key: 'org', label: '组织', match: /^(organization_|branding_)/ },
  { key: 'customer', label: '客户', match: /^(customer_|pool_|prospect_)/ },
  { key: 'contract', label: '合同', match: /^contract_/ },
  { key: 'ai', label: '智能', match: /^ai_/ }
]

const CATEGORY_LABELS = { system: '系统', ...Object.fromEntries(CATEGORIES.map(c => [c.key, c.label])) }

/* 动作的中文名。查不到就显示原始 action —— 便于新动作上线时立刻可读，不用等改代码。 */
const ACTION_LABELS = {
  login: '登录成功',
  login_failed: '登录失败',
  login_blocked: '登录被拦截',
  logout: '退出登录',
  profile_update: '更新个人资料',
  password_change: '修改密码',
  password_change_failed: '修改密码失败',
  user_create: '新建用户',
  user_update: '更新用户',
  permission_group_create: '新建权限组',
  permission_group_update: '更新权限组',
  permission_group_delete: '删除权限组',
  organization_create: '新建组织',
  organization_update: '更新组织信息',
  branding_update: '更新系统标识',
  customer_create: '新建客户',
  customer_to_pool: '客户丢入公海',
  customer_claim: '公海领取客户',
  prospect_deal_status: '商机状态变更',
  ai_provider_create: '新增模型接入',
  ai_provider_update: '更新模型接入',
  ai_provider_delete: '移除模型接入',
  ai_provider_test: '测试模型连通性',
  ai_assignment_update: '调整模型用途分配',
  contract_import: '导入合同',
  contract_commit: '合同入库',
  contract_ai_parse: '合同 AI 解析',
  contract_rules_update: '更新合同解析规则'
}

function categoryOf(action = '') {
  const hit = CATEGORIES.find(c => c.match.test(action))
  return hit ? hit.key : 'system'
}

/* 等级：成功 / 信息 / 警告 / 错误。登录失败算「警告」——它通常是输错密码，
   而不是系统故障，混进错误里会把真正的故障淹掉。 */
const WRITE_ACTION = /_(create|update|delete|change|claim)$/

function levelOf(row) {
  if (row.ok) {
    if (WRITE_ACTION.test(row.action) || row.action === 'customer_to_pool') return 'success'
    return 'info'
  }
  return /^(login_failed|login_blocked)$/.test(row.action) ? 'warning' : 'error'
}

const LEVEL_LABELS = { info: '信息', success: '成功', warning: '警告', error: '错误' }

/* ---------------------------------------------------------------------------
 * 过滤条件只在这里拼一次：列表、计数、统计、导出共用，避免四处走散。
 * 全部走占位参数，不拼字符串。
 * ------------------------------------------------------------------------- */
function buildFilter(query) {
  const where = []
  const params = []

  const level = String(query.level || '').trim()
  const category = String(query.category || '').trim()
  const keyword = String(query.q || '').trim()

  if (keyword) {
    where.push('(username LIKE ? OR action LIKE ? OR detail LIKE ? OR ip LIKE ?)')
    const like = `%${keyword}%`
    params.push(like, like, like, like)
  }
  /* 分类与等级是「从 action / ok 算出来的」，SQL 里没有这两列，
     所以先选出候选行再在内存里筛 —— 日志量级（万行内）完全够用。 */
  const rows = db.prepare(
    `SELECT id, at, username, action, detail, ip, user_agent, ok FROM audit_log
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY id DESC LIMIT 20000`
  ).all(...params)

  const decorated = rows.map(row => ({
    ...row,
    ok: row.ok ? 1 : 0,
    category: categoryOf(row.action),
    level: levelOf(row),
    action_label: ACTION_LABELS[row.action] || row.action
  }))

  return decorated.filter(row =>
    (!level || row.level === level) && (!category || row.category === category))
}

function dayStartIso() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function statsOf(rows) {
  /* 统计永远基于「当前筛选结果」，这样切了分类/等级之后四个数字才对得上列表。 */
  const today = dayStartIso()
  return {
    total: rows.length,
    today: rows.filter(r => r.at >= today).length,
    warning: rows.filter(r => r.level === 'warning').length,
    error: rows.filter(r => r.level === 'error').length
  }
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

/** GET /api/logs —— 分页列表（带统计与可选分类） */
router.get('/logs', auth.requirePermission('audit.view'), (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200)
    const offset = Math.max(Number(req.query.offset) || 0, 0)
    const all = buildFilter(req.query)

    const categoryCounts = {}
    for (const row of all) categoryCounts[row.category] = (categoryCounts[row.category] || 0) + 1

    res.json({
      items: all.slice(offset, offset + limit),
      total: all.length,
      limit,
      offset,
      stats: statsOf(all),
      categories: Object.entries(CATEGORY_LABELS)
        .map(([key, label]) => ({ key, label, count: categoryCounts[key] || 0 }))
        .filter(item => item.count > 0),
      levels: Object.entries(LEVEL_LABELS).map(([key, label]) => ({
        key, label, count: all.filter(r => r.level === key).length
      }))
    })
  } catch (error) {
    res.status(500).json({ error: '读取日志失败：' + error.message })
  }
});

/** GET /api/logs/export —— 导出当前筛选结果为 CSV（带 BOM，Excel 直接打开不乱码） */
router.get('/logs/export', auth.requirePermission('audit.view'), (req, res) => {
  try {
    const rows = buildFilter(req.query).slice(0, 5000)
    const header = ['时间', '等级', '分类', '操作人', '动作', '说明', 'IP', '结果']
    const lines = [header.map(csvCell).join(',')]
    for (const row of rows) {
      lines.push([
        row.at,
        LEVEL_LABELS[row.level] || row.level,
        CATEGORY_LABELS[row.category] || row.category,
        row.username || '—',
        row.action_label,
        row.detail || '',
        row.ip || '',
        row.ok ? '成功' : '失败'
      ].map(csvCell).join(','))
    }

    auth.audit({
      username: req.user.username,
      action: 'audit_export',
      detail: `导出系统日志 ${rows.length} 条`,
      req
    })

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="system-logs-${stamp}.csv"`)
    res.send('\uFEFF' + lines.join('\r\n'))
  } catch (error) {
    res.status(500).json({ error: '导出日志失败：' + error.message })
  }
});

module.exports = router;
