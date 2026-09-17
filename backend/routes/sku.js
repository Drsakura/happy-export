/**
 * 产品目录（SKU）接口 —— 本地实现。
 *
 * 这些路径以前是 4300 原样转发给 sku-manager（3300）的，现在直接落在本库执行。
 * **路径一个字没改**（/api/sku/… 与 /product-images/…），所以前端零改动。
 *
 * 两处刻意偏离原实现，都是因为 happy 这边多了一张 product_packaging 表：
 *   · 删除货号 / 批量删产品时，连带清掉它的包装参数 —— product_packaging.sku 有外键
 *     指向 products(sku)，不清就删不动；产品都没了，包装参数留着也没意义。
 *   · 其余照搬 sku-manager 的口径，包括「调价历史一律保留备查」「撞号落副本不报错」。
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('../db/db');
const catalog = require('../lib/skuCatalog');

const {
  groupKey, normalizeSku, getItemAttrs, getGroupAttrs, replaceAttrs,
  cleanupGroupIfEmpty, insertItem, getContractFile
} = catalog;

/* ------------------------------ 上传（图片） ------------------------------ */

const ALLOWED_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);

/* 直接进内存 → 立刻写进库里，磁盘上不留明文副本（合约与产品图都属于机密数据） */
const imageUpload = multer({
  storage: multer.memoryStorage(),
  defParamCharset: 'utf8',
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_IMAGE_EXT.has(path.extname(file.originalname).toLowerCase())) return cb(null, false);
    cb(null, true);
  },
  limits: { files: 20, fileSize: 15 * 1024 * 1024 }
});

/* -------------------------------- 公共辅助 -------------------------------- */

/** 当前操作者。产品库要留「谁传的、谁改的价」，登录用户就是唯一来源。 */
const actorOf = (req) => req.user?.display_name || req.user?.username || null;
const actorOrgOf = (req) => req.user?.org_id ?? null;

const fail = (res, error, statusCode) =>
  res.status(statusCode || error?.statusCode || 500).json({ error: error?.message || '请求处理失败' });

const api = express.Router();
const images = express.Router();

/* =============================== 查询与检索 =============================== */

/**
 * 产品级搜索：一行一个产品，聚合价格区间/货号数；命中的货号单独列出。
 *
 * 用 LIKE '%kw%' 全表扫 —— 前导通配符**用不上 B-tree 索引**，加索引也没用。
 * 当前规模（516 组 / 1574 货号）端到端 P50 才 8ms 出头，远不到要优化的地步。
 * 真要等到十万级货号再考虑 FTS5 虚拟表，而不是加索引。
 */
api.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  const supplierId = req.query.supplier_id;
  const onlyLow = req.query.only_low === '1';

  const where = [];
  const params = {};

  if (q) {
    where.push(`g.id IN (
      SELECT DISTINCT g2.id FROM product_groups g2
      LEFT JOIN products p2 ON p2.group_id = g2.id
      LEFT JOIN item_attributes a2 ON (a2.group_id = g2.id OR a2.sku = p2.sku)
      WHERE g2.name LIKE @q OR g2.brand LIKE @q OR g2.category LIKE @q OR g2.description LIKE @q
         OR p2.sku LIKE @q OR p2.display_sku LIKE @q OR p2.name LIKE @q
         OR p2.spec LIKE @q OR p2.description LIKE @q
         OR a2.name LIKE @q OR a2.value LIKE @q
    )`);
    params.q = `%${q}%`;
  }
  if (supplierId === 'none') {
    where.push('g.supplier_id IS NULL');
  } else if (supplierId) {
    where.push('g.supplier_id = @supplier_id');
    params.supplier_id = Number(supplierId);
  }
  if (onlyLow) {
    where.push(`EXISTS (SELECT 1 FROM products pl WHERE pl.group_id = g.id AND pl.confidence = 'low')`);
  }

  const groups = db.prepare(
    `SELECT g.id, g.name, g.brand, g.category, g.supplier_id,
            s.name AS supplier_name, s.short_name AS supplier_short,
            (SELECT COUNT(*) FROM products p WHERE p.group_id = g.id) AS item_count,
            (SELECT MIN(p.price) FROM products p WHERE p.group_id = g.id) AS price_min,
            (SELECT MAX(p.price) FROM products p WHERE p.group_id = g.id) AS price_max,
            (SELECT COUNT(*) FROM products p WHERE p.group_id = g.id AND p.confidence = 'low') AS low_count,
            (SELECT MAX(p.last_updated) FROM products p WHERE p.group_id = g.id) AS last_updated,
            (SELECT filename FROM product_images i WHERE i.group_id = g.id
               ORDER BY i.is_primary DESC, i.id ASC LIMIT 1) AS thumb,
            (SELECT COUNT(*) FROM product_images i WHERE i.group_id = g.id) AS image_count
     FROM product_groups g
     LEFT JOIN suppliers s ON s.id = g.supplier_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY last_updated DESC LIMIT 300`
  ).all(params);

  // 搜索词直接命中了哪些货号 —— 前端高亮用
  if (q && groups.length) {
    const ids = groups.map((g) => g.id);
    const hits = db.prepare(
      `SELECT p.group_id, p.sku, p.display_sku FROM products p
       WHERE p.group_id IN (${ids.map(() => '?').join(',')})
         AND (p.sku LIKE ? OR p.display_sku LIKE ? OR p.spec LIKE ? OR p.description LIKE ?
              OR p.sku IN (SELECT a.sku FROM item_attributes a WHERE a.sku IS NOT NULL AND (a.name LIKE ? OR a.value LIKE ?)))`
    ).all(...ids, params.q, params.q, params.q, params.q, params.q, params.q);
    const byGroup = {};
    for (const h of hits) (byGroup[h.group_id] = byGroup[h.group_id] || []).push({ sku: h.sku, display_sku: h.display_sku });
    for (const g of groups) g.matched_items = byGroup[g.id] || [];
  }

  res.json(groups);
});

/** 产品详情：产品 + 全部货号（含各自参数）+ 产品级参数 + 图片。 */
api.get('/group/:id', (req, res) => {
  const id = Number(req.params.id);
  const group = db.prepare(
    `SELECT g.*, s.name AS supplier_name FROM product_groups g
     LEFT JOIN suppliers s ON s.id = g.supplier_id WHERE g.id = ?`
  ).get(id);
  if (!group) return res.status(404).json({ error: 'not found' });

  const items = db.prepare(
    `SELECT p.*, c.terms AS contract_terms,
            (SELECT pi.filename FROM product_images pi
             WHERE pi.group_id = p.group_id ORDER BY pi.is_primary DESC, pi.id ASC LIMIT 1) AS thumb
     FROM products p
     LEFT JOIN contracts c ON c.id = p.contract_id
     WHERE p.group_id = ? ORDER BY p.display_sku`
  ).all(id);
  for (const it of items) it.attributes = getItemAttrs.all(it.sku);

  res.json({
    group,
    groupAttributes: getGroupAttrs.all(id),
    items,
    images: db.prepare('SELECT * FROM product_images WHERE group_id = ? ORDER BY is_primary DESC, id ASC').all(id)
  });
});

/** 编辑产品（名称/品牌/分类/供应商/说明/产品级参数）。 */
api.put('/group/:id', (req, res) => {
  const id = Number(req.params.id);
  const g = db.prepare('SELECT * FROM product_groups WHERE id = ?').get(id);
  if (!g) return res.status(404).json({ error: 'not found' });

  const b = req.body || {};
  const name = b.name?.trim();
  if (!name) return res.status(400).json({ error: '产品名称不能为空' });

  db.prepare(
    `UPDATE product_groups SET name=@name, group_key=@group_key, brand=@brand,
       category=@category, description=@description, supplier_id=@supplier_id, updated_at=@now WHERE id=@id`
  ).run({
    id,
    name,
    group_key: groupKey(name),
    brand: b.brand?.trim() || null,
    category: b.category?.trim() || null,
    description: b.description?.trim() || null,
    supplier_id: b.supplier_id ? Number(b.supplier_id) : null,
    now: new Date().toISOString()
  });

  if (Array.isArray(b.attributes)) replaceAttrs({ groupId: id }, b.attributes);
  res.json({ ok: true });
});

/* ================================ 货号读写 ================================ */

/** 新建产品（必须带第一个货号）。 */
api.post('/groups', (req, res) => {
  const b = req.body || {};
  const name = b.name?.trim();
  if (!name) return res.status(400).json({ error: '产品名称不能为空' });
  if (!b.item || !String(b.item.sku || '').trim()) return res.status(400).json({ error: '至少需要一个货号' });

  const supplierId = b.supplier_id ? Number(b.supplier_id) : null;
  const groupId = db.prepare(
    `INSERT INTO product_groups (name, group_key, brand, category, description, supplier_id, created_at)
     VALUES (@name, @group_key, @brand, @category, @description, @supplier_id, @created_at)`
  ).run({
    name,
    group_key: groupKey(name),
    brand: b.brand?.trim() || null,
    category: b.category?.trim() || null,
    description: b.description?.trim() || null,
    supplier_id: supplierId,
    created_at: new Date().toISOString()
  }).lastInsertRowid;

  const r = insertItem({ ...b.item, name }, groupId, supplierId, actorOf(req), actorOrgOf(req));
  if (r.error) {
    cleanupGroupIfEmpty(groupId);
    return res.status(400).json(r);
  }
  res.json({
    group_id: groupId,
    sku: r.sku,
    display_sku: r.displaySku,
    duplicated_from: r.duplicatedFrom || null,
    uploader: actorOf(req)
  });
});

/** 给已有产品加货号。 */
api.post('/group/:id/items', (req, res) => {
  const id = Number(req.params.id);
  const g = db.prepare('SELECT * FROM product_groups WHERE id = ?').get(id);
  if (!g) return res.status(404).json({ error: 'not found' });

  const r = insertItem({ ...req.body, name: req.body?.name ?? g.name }, id, g.supplier_id, actorOf(req), actorOrgOf(req));
  if (r.error) return res.status(400).json(r);
  res.json({
    sku: r.sku,
    display_sku: r.displaySku,
    duplicated_from: r.duplicatedFrom || null,
    uploader: actorOf(req)
  });
});

/** 货号详情（编辑器用）：含参数与调价历史。 */
api.get('/product/:sku', (req, res) => {
  const sku = req.params.sku.toUpperCase();
  const product = db.prepare(
    `SELECT p.*, s.name AS supplier_name, c.terms AS contract_terms
     FROM products p
     LEFT JOIN suppliers s ON s.id = p.supplier_id
     LEFT JOIN contracts c ON c.id = p.contract_id
     WHERE p.sku = ?`
  ).get(sku);
  if (!product) return res.status(404).json({ error: 'not found' });

  product.attributes = getItemAttrs.all(sku);
  const history = db.prepare(
    `SELECT h.*, s.name AS supplier_name FROM price_history h
     LEFT JOIN suppliers s ON s.id = h.supplier_id
     WHERE h.sku = ? ORDER BY h.changed_at DESC LIMIT 50`
  ).all(sku);
  res.json({ product, history });
});

/** 手工修正货号 —— 表头千奇百怪，总有识别不准需要人工改的。 */
api.put('/product/:sku', (req, res) => {
  const sku = req.params.sku.toUpperCase();
  const existing = db.prepare('SELECT * FROM products WHERE sku = ?').get(sku);
  if (!existing) return res.status(404).json({ error: 'not found' });

  const b = req.body || {};
  const moq = b.moq === '' || b.moq === null || b.moq === undefined ? null : Number(b.moq);
  if (moq !== null && (!Number.isFinite(moq) || moq < 0)) return res.status(400).json({ error: '起订量必须是非负数字' });

  /* 价格只有在没有合同来源时才允许手改 —— 合同解析出来的价格必须保持可追溯，
     否则下次导入同一份合同又被覆盖，反而让人以为改丢了。 */
  const priceEditable = !existing.contract_id;
  let price = existing.price;
  if (priceEditable && b.price !== undefined) {
    price = b.price === '' || b.price === null ? null : Number(b.price);
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      return res.status(400).json({ error: '采购价必须是非负数字' });
    }
  }

  // 移动到其他产品 / 独立成新产品
  let targetGroup = existing.group_id;
  const oldGroup = existing.group_id;
  if (b.group_id === 'new') {
    targetGroup = db.prepare(
      `INSERT INTO product_groups (name, group_key, supplier_id, created_at)
       VALUES (@name, @group_key, @supplier_id, @created_at)`
    ).run({
      name: b.name?.trim() || existing.name || existing.display_sku || sku,
      group_key: 'SKU:' + sku,
      supplier_id: existing.supplier_id ?? null,
      created_at: new Date().toISOString()
    }).lastInsertRowid;
  } else if (b.group_id !== undefined && b.group_id !== null && b.group_id !== '') {
    const g = db.prepare('SELECT id FROM product_groups WHERE id = ?').get(Number(b.group_id));
    if (!g) return res.status(400).json({ error: '目标产品不存在' });
    targetGroup = g.id;
  }

  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      `UPDATE products SET
         name = @name, spec = @spec, description = @description,
         price = @price, moq = @moq, group_id = @group_id,
         last_updated = @now, updated_at = @now
       WHERE sku = @sku`
    ).run({
      sku,
      name: b.name?.trim() || null,
      spec: b.spec?.trim() || null,
      description: b.description?.trim() || null,
      price,
      moq,
      group_id: targetGroup,
      now
    });

    if (priceEditable && (price !== existing.price || moq !== existing.moq)) {
      db.prepare(
        `INSERT INTO price_history (sku, old_price, new_price, old_moq, new_moq, currency,
                                    supplier_id, source_contract, confidence, changed_at, changed_by)
         VALUES (@sku, @old_price, @new_price, @old_moq, @new_moq, 'CNY',
                 @supplier_id, '手工修改', 'high', @now, @changed_by)`
      ).run({
        sku,
        old_price: existing.price,
        new_price: price,
        old_moq: existing.moq,
        new_moq: moq,
        supplier_id: existing.supplier_id ?? null,
        now,
        changed_by: actorOf(req)
      });
    }
  })();

  if (Array.isArray(b.attributes)) replaceAttrs({ sku }, b.attributes);
  if (targetGroup !== oldGroup) cleanupGroupIfEmpty(oldGroup);

  res.json({ ok: true, priceEditable, group_id: targetGroup });
});

/** 删除货号（调价历史保留备查；所在产品变空则一并清理）。 */
api.delete('/product/:sku', (req, res) => {
  const sku = req.params.sku.toUpperCase();
  const existing = db.prepare('SELECT * FROM products WHERE sku = ?').get(sku);
  if (!existing) return res.status(404).json({ error: 'not found' });

  db.transaction(() => {
    db.prepare('DELETE FROM item_attributes WHERE sku = ?').run(sku);
    db.prepare('DELETE FROM cart_items WHERE sku = ?').run(sku);
    // happy 特有：包装参数挂在外键上，产品没了必须先摘掉，否则删不动
    db.prepare('DELETE FROM product_packaging WHERE sku = ?').run(sku);
    db.prepare('DELETE FROM products WHERE sku = ?').run(sku);
  })();
  cleanupGroupIfEmpty(existing.group_id);
  res.json({ ok: true });
});

/** 批量删除产品（整个 SPU 连同下挂货号）。 */
api.post('/groups/delete', (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : [])
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) return res.status(400).json({ error: '没有选中任何产品' });

  const ph = ids.map(() => '?').join(',');
  const imgIds = db.prepare(`SELECT id FROM product_images WHERE group_id IN (${ph})`).all(...ids).map((r) => r.id);

  let groups = 0;
  let items = 0;
  db.transaction(() => {
    // 图片二进制跟着一起删，否则库里会积一堆没人引用的 BLOB，越攒越大
    catalog.deleteImagesFor(imgIds);
    const skus = db.prepare(`SELECT sku FROM products WHERE group_id IN (${ph})`).all(...ids);
    items = skus.length;
    if (skus.length) {
      const sph = skus.map(() => '?').join(',');
      const args = skus.map((r) => r.sku);
      db.prepare(`DELETE FROM item_attributes WHERE sku IN (${sph})`).run(...args);
      db.prepare(`DELETE FROM cart_items WHERE sku IN (${sph})`).run(...args);
      db.prepare(`DELETE FROM product_packaging WHERE sku IN (${sph})`).run(...args);
      db.prepare(`DELETE FROM products WHERE sku IN (${sph})`).run(...args);
    }
    db.prepare(`DELETE FROM item_attributes WHERE group_id IN (${ph})`).run(...ids);
    db.prepare(`DELETE FROM product_images WHERE group_id IN (${ph})`).run(...ids);
    groups = db.prepare(`DELETE FROM product_groups WHERE id IN (${ph})`).run(...ids).changes;
  })();

  res.json({ ok: true, groups, items });
});

/* ================================= 小推车 ================================= */

const CART_COLUMNS = `
  c.sku, c.qty, c.note, c.sort, c.added_at,
  p.display_sku, p.spec, p.price, p.currency, p.moq,
  p.description, p.confidence, p.last_updated,
  g.id AS group_id, g.name AS product_name, g.brand, g.category,
  s.name AS supplier_name, s.short_name AS supplier_short,
  (SELECT filename FROM product_images i WHERE i.group_id = g.id
    ORDER BY i.is_primary DESC, i.id ASC LIMIT 1) AS image`;

const cartRows = () => db.prepare(
  `SELECT ${CART_COLUMNS}
   FROM cart_items c
   JOIN products p ON p.sku = c.sku
   LEFT JOIN product_groups g ON g.id = p.group_id
   LEFT JOIN suppliers s ON s.id = p.supplier_id
   ORDER BY c.sort, c.id`
).all();

api.get('/cart', (req, res) => res.json(cartRows()));

/**
 * 加入小推车。可以直接给货号，也可以给产品 id（该产品下所有货号一起进）。
 * 已在车里的不动 —— 重复点「加入」不该把用户排好的顺序打乱。
 */
api.post('/cart', (req, res) => {
  const skus = (Array.isArray(req.body?.skus) ? req.body.skus : []).map((s) => String(s).toUpperCase());
  const groupIds = (Array.isArray(req.body?.group_ids) ? req.body.group_ids : [])
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);

  if (groupIds.length) {
    const ph = groupIds.map(() => '?').join(',');
    for (const r of db.prepare(`SELECT sku FROM products WHERE group_id IN (${ph}) ORDER BY display_sku`).all(...groupIds)) {
      skus.push(r.sku);
    }
  }
  if (!skus.length) return res.status(400).json({ error: '没有可加入的货号' });

  const now = new Date().toISOString();
  let added = 0;
  db.transaction(() => {
    let sort = db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM cart_items').get().m;
    const exists = db.prepare('SELECT 1 FROM cart_items WHERE sku = ?');
    const real = db.prepare('SELECT 1 FROM products WHERE sku = ?');
    const ins = db.prepare('INSERT INTO cart_items (sku, sort, added_at) VALUES (@sku, @sort, @added_at)');
    for (const sku of skus) {
      if (exists.get(sku) || !real.get(sku)) continue;
      ins.run({ sku, sort: ++sort, added_at: now });
      added += 1;
    }
  })();

  res.json({ ok: true, added, rows: cartRows() });
});

api.patch('/cart/:sku', (req, res) => {
  const sku = req.params.sku.toUpperCase();
  if (!db.prepare('SELECT 1 FROM cart_items WHERE sku = ?').get(sku)) return res.status(404).json({ error: 'not found' });

  const b = req.body || {};
  if ('qty' in b) {
    // 空/0 表示「没定数量」，出报价单时按未填处理，不要落成 0
    const n = Number(b.qty);
    db.prepare('UPDATE cart_items SET qty = ? WHERE sku = ?').run(Number.isFinite(n) && n > 0 ? Math.round(n) : null, sku);
  }
  if ('note' in b) {
    db.prepare('UPDATE cart_items SET note = ? WHERE sku = ?').run(String(b.note || '').trim() || null, sku);
  }
  res.json({ ok: true, rows: cartRows() });
});

api.delete('/cart/:sku', (req, res) => {
  db.prepare('DELETE FROM cart_items WHERE sku = ?').run(req.params.sku.toUpperCase());
  res.json({ ok: true, rows: cartRows() });
});

api.post('/cart/clear', (req, res) => {
  db.prepare('DELETE FROM cart_items').run();
  res.json({ ok: true, rows: [] });
});

/** 拖拽排序落库。只认车里已有的货号，顺序按传入数组重排。 */
api.put('/cart/order', (req, res) => {
  const skus = (Array.isArray(req.body?.skus) ? req.body.skus : []).map((s) => String(s).toUpperCase());
  db.transaction(() => {
    const upd = db.prepare('UPDATE cart_items SET sort = ? WHERE sku = ?');
    skus.forEach((sku, i) => upd.run(i, sku));
  })();
  res.json({ ok: true, rows: cartRows() });
});

/* =============================== 参数与图片 =============================== */

/** 参数名自动补全 —— 输过一次的参数名，下次直接选。 */
api.get('/attr-names', (req, res) => {
  const q = (req.query.q || '').trim();
  const rows = q
    ? db.prepare('SELECT DISTINCT name FROM item_attributes WHERE name LIKE ? ORDER BY name LIMIT 30').all(`%${q}%`)
    : db.prepare('SELECT DISTINCT name FROM item_attributes ORDER BY name LIMIT 30').all();
  res.json(rows.map((r) => r.name));
});

/**
 * 批量取货号缩略图。
 *
 * 「凡是出现货号的地方最前面都要有缩略图」，那些位置（询盘明细、报价明细、合同待复核、
 * 选品器）手里只有货号、没有图片字段 —— 逐个调 /api/sku/product/:sku 既慢又拿不到图，
 * 所以给一个一次问一批的入口。
 *
 * 图片挂在**产品组**上（product_images.group_id），先按货号找到组再取该组主图。
 * 大小写不敏感（客户端传来的货号大小写不一定规范）。单次上限 500，防止被塞超大数组。
 */
api.get('/thumbs', (req, res) => {
  const skus = [...new Set(String(req.query.skus || '').split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 500);
  if (!skus.length) return res.json({ thumbs: {} });

  const rows = db.prepare(
    `SELECT p.sku,
            (SELECT pi.filename FROM product_images pi
             WHERE pi.group_id = p.group_id AND pi.group_id IS NOT NULL
             ORDER BY pi.is_primary DESC, pi.id ASC LIMIT 1) AS thumb
     FROM products p
     WHERE p.sku IN (${skus.map(() => '?').join(',')}) COLLATE NOCASE`
  ).all(...skus);

  const thumbs = {};
  for (const row of rows) if (row.thumb) thumbs[row.sku] = row.thumb;
  res.json({ thumbs });
});

api.post('/group/:id/images', imageUpload.array('images', 20), (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT id FROM product_groups WHERE id = ?').get(id)) return res.status(404).json({ error: 'not found' });
  if (!req.files || !req.files.length) {
    return res.status(400).json({ error: '没有收到图片（只支持 jpg/png/webp/gif/bmp）' });
  }

  const existing = db.prepare('SELECT COUNT(*) AS n FROM product_images WHERE group_id = ?').get(id).n;
  const insert = db.prepare(
    `INSERT INTO product_images (sku, group_id, filename, original_name, is_primary, created_at)
     VALUES ('', @group_id, @filename, @original_name, @is_primary, @created_at)`
  );

  db.transaction(() => {
    req.files.forEach((f, i) => {
      const ext = path.extname(f.originalname).toLowerCase();
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
      const info = insert.run({
        group_id: id,
        filename,
        original_name: f.originalname,
        is_primary: existing === 0 && i === 0 ? 1 : 0,
        created_at: new Date().toISOString()
      });
      // 二进制直接进库；文件本来就在内存里，磁盘上不留明文副本
      catalog.storeImage(info.lastInsertRowid, f.buffer);
    });
  })();

  res.json({
    images: db.prepare('SELECT * FROM product_images WHERE group_id = ? ORDER BY is_primary DESC, id ASC').all(id)
  });
});

api.post('/images/:id/primary', (req, res) => {
  const img = db.prepare('SELECT * FROM product_images WHERE id = ?').get(Number(req.params.id));
  if (!img) return res.status(404).json({ error: 'not found' });
  db.transaction(() => {
    db.prepare('UPDATE product_images SET is_primary = 0 WHERE group_id = ?').run(img.group_id);
    db.prepare('UPDATE product_images SET is_primary = 1 WHERE id = ?').run(img.id);
  })();
  res.json({ ok: true });
});

api.delete('/images/:id', (req, res) => {
  const img = db.prepare('SELECT * FROM product_images WHERE id = ?').get(Number(req.params.id));
  if (!img) return res.status(404).json({ error: 'not found' });

  db.prepare('DELETE FROM product_images WHERE id = ?').run(img.id);
  // 删掉记录后把封面顺延给剩下的第一张
  if (img.is_primary) {
    const next = db.prepare('SELECT id FROM product_images WHERE group_id = ? ORDER BY id ASC LIMIT 1').get(img.group_id);
    if (next) db.prepare('UPDATE product_images SET is_primary = 1 WHERE id = ?').run(next.id);
  }
  catalog.deleteImage(img.id);
  res.json({ ok: true });
});

/** 下载合同原件（原件只存在库里，磁盘上没有）。 */
api.get('/contracts/:id/file', (req, res) => {
  const f = getContractFile(Number(req.params.id));
  if (!f) return res.status(404).json({ error: '库里没有这份合同的原件' });

  res.setHeader('Content-Type', f.mime || 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="contract"; filename*=UTF-8''${encodeURIComponent(f.filename)}`
  );
  res.end(f.bytes);
});

/* ================================== 统计 ================================== */

api.get('/stats', (req, res) => {
  res.json(db.prepare(
    `SELECT
      (SELECT COUNT(*) FROM product_groups) AS total_groups,
      (SELECT COUNT(*) FROM products) AS total_skus,
      (SELECT COUNT(*) FROM products WHERE confidence = 'low') AS low_confidence,
      (SELECT COUNT(*) FROM suppliers) AS total_suppliers,
      (SELECT COUNT(*) FROM contracts) AS contracts_processed`
  ).get());
});

/* ================================= 供应商 ================================= */

api.get('/suppliers', (req, res) => {
  res.json(db.prepare(
    `SELECT s.*,
            (SELECT COUNT(*) FROM product_groups g WHERE g.supplier_id = s.id) AS group_count,
            (SELECT COUNT(*) FROM products p WHERE p.supplier_id = s.id) AS sku_count
     FROM suppliers s ORDER BY s.name`
  ).all());
});

/** 没归属供应商的产品数 —— 手工建的货常常一时定不下供应商。 */
api.get('/suppliers/unassigned/count', (req, res) => {
  res.json(db.prepare('SELECT COUNT(*) AS count FROM product_groups WHERE supplier_id IS NULL').get());
});

api.get('/suppliers/:id', (req, res) => {
  const id = Number(req.params.id);
  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
  if (!supplier) return res.status(404).json({ error: 'not found' });

  res.json({
    supplier,
    products: db.prepare(
      `SELECT p.*, g.name AS group_name,
              (SELECT filename FROM product_images i WHERE i.group_id = p.group_id
                 ORDER BY i.is_primary DESC, i.id ASC LIMIT 1) AS thumb
       FROM products p LEFT JOIN product_groups g ON g.id = p.group_id
       WHERE p.supplier_id = ? ORDER BY p.last_updated DESC LIMIT 500`
    ).all(id),
    contracts: db.prepare('SELECT * FROM contracts WHERE supplier_id = ? ORDER BY processed_at DESC LIMIT 50').all(id)
  });
});

const SUPPLIER_FIELDS = [
  'name', 'short_name', 'contact_person', 'phone',
  'email', 'address', 'website', 'payment_terms', 'main_categories', 'notes'
];

const supplierPayload = (body) => {
  const out = {};
  for (const f of SUPPLIER_FIELDS) out[f] = body?.[f] ?? null;
  return out;
};

api.post('/suppliers', (req, res) => {
  const data = supplierPayload(req.body);
  if (!data.name) return res.status(400).json({ error: '供应商名称不能为空' });
  try {
    const now = new Date().toISOString();
    const info = db.prepare(
      `INSERT INTO suppliers (name, short_name, contact_person, phone, email, address, website,
                              payment_terms, main_categories, notes, created_at, updated_at)
       VALUES (@name, @short_name, @contact_person, @phone, @email, @address, @website,
               @payment_terms, @main_categories, @notes, @created_at, @updated_at)`
    ).run({ ...data, created_at: now, updated_at: now });
    res.json({ id: info.lastInsertRowid });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: '该供应商名称已存在' });
    fail(res, err);
  }
});

api.put('/suppliers/:id', (req, res) => {
  const data = supplierPayload(req.body);
  if (!data.name) return res.status(400).json({ error: '供应商名称不能为空' });
  try {
    db.prepare(
      `UPDATE suppliers SET name=@name, short_name=@short_name, contact_person=@contact_person,
        phone=@phone, email=@email, address=@address, website=@website,
        payment_terms=@payment_terms, main_categories=@main_categories, notes=@notes,
        updated_at=@updated_at WHERE id=@id`
    ).run({ ...data, id: Number(req.params.id), updated_at: new Date().toISOString() });
    res.json({ ok: true });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: '该供应商名称已存在' });
    fail(res, err);
  }
});

api.delete('/suppliers/:id', (req, res) => {
  const id = Number(req.params.id);
  // 产品保留原价，只是变成「未指派供应商」，而不是跟着被删
  db.transaction(() => {
    db.prepare('UPDATE products SET supplier_id = NULL WHERE supplier_id = ?').run(id);
    db.prepare('UPDATE product_groups SET supplier_id = NULL WHERE supplier_id = ?').run(id);
    db.prepare('DELETE FROM suppliers WHERE id = ?').run(id);
  })();
  res.json({ ok: true });
});

/* ============================== 产品图片文件 ============================== */

/**
 * /product-images/<文件名>。
 *
 * 图片存在库里（product_image_files），按文件名去查而不是拼磁盘路径 ——
 * 顺带也就没有路径穿越这回事了。
 *
 * 这里要求登录：产品图属于商业数据，原先挂在裸 static 上等于「猜到文件名就能拿图」。
 * 页面里的 <img> 是同源请求，会带上会话 cookie，所以登录后照常显示。
 */
images.get('/:filename', (req, res) => {
  if (!req.user) return res.status(401).end();

  const name = req.params.filename;
  const img = db.prepare('SELECT id FROM product_images WHERE filename = ?').get(name);
  if (!img) return res.status(404).end();

  const blob = catalog.getImage(img.id);
  if (!blob) return res.status(404).end();

  res.setHeader('Content-Type', catalog.mimeFor(name));
  // 文件名带时间戳+随机串，内容不会变，可以让浏览器长缓存。
  // private：机密数据，不许中间代理留副本。
  res.setHeader('Cache-Control', 'private, max-age=604800');
  res.end(blob.bytes);
});

module.exports = { api, images };
