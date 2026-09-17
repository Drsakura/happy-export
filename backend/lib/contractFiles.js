/**
 * 合同原件的磁盘留存 + 到期清理。
 *
 * 为什么放磁盘而不是继续用 `contract_files` 的 BLOB：
 *   留原件的唯一目的是「复核那几天能回去核对一眼」，7 天后就要删掉省 VPS 空间。
 *   而 SQLite 删掉 BLOB 后空间并不会还给系统（要 VACUUM 整库重写才还），
 *   与「省空间」的目标正好相反。磁盘文件删掉就是删掉。
 *
 * 目录结构：<DATA_DIR>/contracts/<job_no>/<清洗过的原文件名>
 *   —— 用 job_no 分目录，清理时按目录整删即可，不需要额外记路径（也就不需要加字段）。
 *
 * ⚠️ 安全：目录名与文件名都来自用户，必须防越权路径。
 *    job_no 由服务端生成（CIMP-数字-数字），文件名统一过 sanitizeFileName，
 *    拼好之后再校验 resolved 路径确实落在 contracts 根目录之内。
 */

const fs = require('fs');
const path = require('path');

const RETENTION_DAYS = Number(process.env.CONTRACT_RETENTION_DAYS || 7);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const ROOT = path.join(DATA_DIR, 'contracts');

/** 清洗文件名：去掉路径分隔与控制字符，压掉长度，保留中文 */
function sanitizeFileName(name) {
  const base = path.basename(String(name || '')).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const safe = base.replace(/[\\/:*?"<>|]/g, '_').replace(/^\.+/, '');
  const trimmed = safe.slice(0, 120) || 'contract';
  return trimmed;
}

/** 防越权：任何对外暴露的路径都要过这一关 */
function resolveInside(jobNo, fileName) {
  const dir = path.join(ROOT, String(jobNo || '').replace(/[^\w-]/g, ''));
  const target = path.join(dir, sanitizeFileName(fileName));
  const rootResolved = path.resolve(ROOT);
  const targetResolved = path.resolve(target);
  if (targetResolved !== rootResolved && !targetResolved.startsWith(rootResolved + path.sep)) return null;
  return targetResolved;
}

/**
 * 保存一份原件。失败不抛 —— 原件只是辅助材料，解析结果才是主产物，
 * 不能因为磁盘满了就把整次导入判失败。
 */
function saveOriginal(jobNo, file) {
  try {
    if (!jobNo || !file?.buffer?.length) return null;
    const dir = path.join(ROOT, String(jobNo).replace(/[^\w-]/g, ''));
    fs.mkdirSync(dir, { recursive: true });

    // 同名文件加序号后缀，避免后来者覆盖前一个
    const wanted = sanitizeFileName(file.originalname);
    let target = path.join(dir, wanted);
    let seq = 1;
    const ext = path.extname(wanted);
    const stem = path.basename(wanted, ext);
    while (fs.existsSync(target)) {
      seq += 1;
      target = path.join(dir, `${stem}-${seq}${ext}`);
    }

    fs.writeFileSync(target, file.buffer);
    return { name: path.basename(target), size: file.buffer.length };
  } catch {
    return null;
  }
}

/** 列出某个任务还留着的原件 */
function listOriginals(jobNo) {
  try {
    const dir = path.join(ROOT, String(jobNo).replace(/[^\w-]/g, ''));
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).map(name => {
      const stat = fs.statSync(path.join(dir, name));
      return { name, size: stat.size, stored_at: stat.mtime.toISOString() };
    });
  } catch {
    return [];
  }
}

/** 取某一份原件（下载用）。不存在返回 null —— 界面据此显示「已过期清理」。 */
function readOriginal(jobNo, fileName) {
  const target = resolveInside(jobNo, fileName);
  if (!target) return null;
  try {
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return null;
    return { path: target, name: path.basename(target), buffer: fs.readFileSync(target) };
  } catch {
    return null;
  }
}

/**
 * 清理过期原件。
 *
 * 到期判定用**任务创建时间**（库里查得到的权威时间），不用目录 mtime ——
 * mtime 会被「同 job 再传一次文件」刷新，导致该清的清不掉。
 * 库里查不到对应任务的孤儿目录，按目录 mtime 兜底删。
 */
function purgeExpired(db, retentionDays = RETENTION_DAYS) {
  const removed = [];
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let dirs = [];
  try {
    if (!fs.existsSync(ROOT)) return { removed, scanned: 0 };
    dirs = fs.readdirSync(ROOT).filter(name => {
      try { return fs.statSync(path.join(ROOT, name)).isDirectory(); } catch { return false; }
    });
  } catch {
    return { removed, scanned: 0 };
  }

  for (const jobNo of dirs) {
    const dir = path.join(ROOT, jobNo);
    let expired = false;
    try {
      const job = db.prepare('SELECT created_at FROM contract_import_jobs WHERE job_no = ?').get(jobNo);
      const stamp = job?.created_at ? Date.parse(job.created_at) : fs.statSync(dir).mtimeMs;
      expired = Number.isFinite(stamp) && stamp < cutoffMs;
    } catch {
      expired = false;
    }
    if (!expired) continue;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      removed.push(jobNo);
    } catch {
      /* 删不掉（占着句柄等）下一轮再试，不影响服务 */
    }
  }
  return { removed, scanned: dirs.length };
}

/**
 * 启动时清一次 + 之后每 6 小时一次。
 * 用 unref() 让定时器不阻止进程退出（否则 nodemon 重启会挂着）。
 */
function startPurgeSchedule(db, logger = console) {
  const run = () => {
    try {
      const { removed } = purgeExpired(db);
      if (removed.length) logger.log(`[contracts] 已清理 ${removed.length} 个到期的合同原件（保留 ${RETENTION_DAYS} 天）`);
    } catch (error) {
      logger.error?.('[contracts] 清理合同原件失败：', error.message);
    }
  };
  run();
  const timer = setInterval(run, 6 * 60 * 60 * 1000);
  timer.unref?.();
  return timer;
}

module.exports = {
  RETENTION_DAYS,
  ROOT,
  sanitizeFileName,
  saveOriginal,
  listOriginals,
  readOriginal,
  purgeExpired,
  startPurgeSchedule
};
