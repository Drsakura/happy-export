/**
 * 产品目录（SKU 模块）的本地数据层。
 *
 * 这块原先是独立的 sku-manager 服务（3300），happy 通过 /api/sku 代理访问它。
 * 合并后数据直接落在 trade.db：少一个进程、少一个端口，开源部署只跑 4300 + 5300。
 *
 * 表结构沿用 sku-manager 那套（products / product_groups / suppliers / item_attributes /
 * product_images / price_history / cart_items），列名保持一致 —— 迁移是按原 id 整表搬过来的，
 * 所以这里的外键关系与历史数据完全对得上，不需要任何 id 映射。
 */
const crypto = require('crypto');
const db = require('../db/db');

/* --------------------------------- 规范化 --------------------------------- */

/**
 * 货号规范化：去掉空格、连字符、下划线、斜杠、点，再转大写。
 * 合同里的「GD-100F」和产品库里的「GD100F」必须归到同一条。
 */
function normalizeSku(raw) {
  if (!raw) return null;
  return String(raw).toUpperCase().replace(/[\s\-_./]/g, '').trim();
}

/**
 * 产品归组键：同一单品的不同尺寸归为一个产品。
 * 只剥「尺寸/规格」类字样（8x10、200mm、1/2"、6寸），件数（6件套）保留 ——
 * 套装件数不同是不同的产品。
 */
function groupKey(name) {
  if (!name) return null;
  let s = String(name).replace(/\s+/g, '');
  s = s.replace(/\d+(\.\d+)?[x×*]\d+(\.\d+)?(mm|cm)?/gi, '');
  s = s.replace(/\d+\/\d+(["″”寸]|英寸)?/g, '');
  s = s.replace(/\d+(\.\d+)?(mm|cm|寸|英寸|inch|in|"|″|”|米)/gi, '');
  s = s.replace(/[-—–()（）]/g, '');
  const key = s.toUpperCase();
  return key || String(name).trim().toUpperCase();
}

/* ------------------------------ 二进制存储 ------------------------------ */

const MIME_BY_EXT = {
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp'
};

function mimeFor(name) {
  const i = String(name).lastIndexOf('.');
  return (i >= 0 && MIME_BY_EXT[String(name).slice(i).toLowerCase()]) || 'application/octet-stream';
}

const syncImageStmt = db.prepare(
  `INSERT INTO product_image_files (image_id, bytes, size, stored_at)
   VALUES (@image_id, @bytes, @size, @stored_at)
   ON CONFLICT(image_id) DO UPDATE SET bytes = excluded.bytes, size = excluded.size, stored_at = excluded.stored_at`
);
const getImageStmt = db.prepare('SELECT bytes, size FROM product_image_files WHERE image_id = ?');
const delImageStmt = db.prepare('DELETE FROM product_image_files WHERE image_id = ?');

const storeImage = (imageId, buf) =>
  syncImageStmt.run({ image_id: imageId, bytes: buf, size: buf.length, stored_at: new Date().toISOString() });

const getImage = (imageId) => getImageStmt.get(imageId);
const deleteImage = (imageId) => delImageStmt.run(imageId);

/** 批量删图（批量删产品时用），避免逐条 delete。 */
function deleteImagesFor(imageIds) {
  if (!imageIds.length) return;
  db.prepare(`DELETE FROM product_image_files WHERE image_id IN (${imageIds.map(() => '?').join(',')})`)
    .run(...imageIds);
}

/* ------------------------------- 合同原件 ------------------------------- */

const putContractStmt = db.prepare(
  `INSERT INTO contract_files (contract_id, filename, mime, size, sha256, bytes, stored_at)
   VALUES (@contract_id, @filename, @mime, @size, @sha256, @bytes, @stored_at)
   ON CONFLICT(contract_id) DO UPDATE SET
     filename = excluded.filename, mime = excluded.mime, size = excluded.size,
     sha256 = excluded.sha256, bytes = excluded.bytes, stored_at = excluded.stored_at`
);

/** 把一份合同原件收进库。返回 null 表示没收到（不算致命，解析结果才是主产物）。 */
function storeContractFile(contractId, bytes, displayName) {
  if (!bytes || !bytes.length) return null;
  const filename = displayName || `contract-${contractId}`;
  putContractStmt.run({
    contract_id: contractId,
    filename,
    mime: mimeFor(filename),
    size: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    bytes,
    stored_at: new Date().toISOString()
  });
  return { size: bytes.length };
}

const getContractFile = (contractId) =>
  db.prepare('SELECT filename, mime, size, bytes FROM contract_files WHERE contract_id = ?').get(contractId);

/* --------------------------------- 参数 --------------------------------- */

const getItemAttrs = db.prepare(
  'SELECT id, name, value, sort FROM item_attributes WHERE sku = ? ORDER BY sort, id'
);
const getGroupAttrs = db.prepare(
  'SELECT id, name, value, sort FROM item_attributes WHERE group_id = ? AND sku IS NULL ORDER BY sort, id'
);

/** 整组替换参数（货号级或产品级）。传入 [{name, value}]，空名跳过。 */
function replaceAttrs({ sku = null, groupId = null }, attrs) {
  if (!Array.isArray(attrs)) return;
  db.transaction(() => {
    if (sku) db.prepare('DELETE FROM item_attributes WHERE sku = ?').run(sku);
    else db.prepare('DELETE FROM item_attributes WHERE group_id = ? AND sku IS NULL').run(groupId);
    const ins = db.prepare(
      'INSERT INTO item_attributes (group_id, sku, name, value, sort) VALUES (@group_id, @sku, @name, @value, @sort)'
    );
    attrs.forEach((a, i) => {
      const name = String(a?.name || '').trim();
      if (!name) return;
      ins.run({ group_id: sku ? null : groupId, sku, name, value: String(a?.value ?? '').trim() || null, sort: i });
    });
  })();
}

/** 产品组变空后清理掉，避免列表里留下没有货号的壳（有图片的保留）。 */
function cleanupGroupIfEmpty(groupId) {
  if (!groupId) return;
  const hasItems = db.prepare('SELECT 1 FROM products WHERE group_id = ? LIMIT 1').get(groupId);
  const hasImages = db.prepare('SELECT 1 FROM product_images WHERE group_id = ? LIMIT 1').get(groupId);
  if (!hasItems && !hasImages) {
    db.prepare('DELETE FROM item_attributes WHERE group_id = ?').run(groupId);
    db.prepare('DELETE FROM product_groups WHERE id = ?').run(groupId);
  }
}

/* --------------------------------- 货号 --------------------------------- */

function validatePriceMoq(b) {
  const price = b.price === '' || b.price == null ? null : Number(b.price);
  if (price !== null && (!Number.isFinite(price) || price < 0)) return { error: '采购价必须是非负数字' };
  const moq = b.moq === '' || b.moq == null ? null : Number(b.moq);
  if (moq !== null && (!Number.isFinite(moq) || moq < 0)) return { error: '起订量必须是非负数字' };
  return { price, moq };
}

/**
 * 新增货号。
 *
 * 货号重复**不当错误** —— 产品库是组织共享的，谁都能上传自己那一版：
 * 撞号时落成兄弟副本 `<SKU>-COPY2 / -COPY3 …`，display_sku 加「-副本N」，
 * 并用 duplicated_from 记住它复制自哪个货号，界面上标出来，避免两条同名货号看着像脏数据。
 * 无论是否重复都记 uploader / org_id；手工价同时写 changed_by，保证「谁传的、谁改的价」可追。
 */
function insertItem(b, groupId, supplierId, actor = null, actorOrg = null, options = {}) {
  const displaySku = String(b.sku || '').trim();
  const base = normalizeSku(displaySku);
  if (!base) return { error: '货号不能为空' };
  const v = validatePriceMoq(b);
  if (v.error) return v;

  const taken = (candidate) => !!db.prepare('SELECT sku FROM products WHERE sku = ?').get(candidate);
  let sku = base;
  let display = displaySku;
  let duplicatedFrom = null;
  if (taken(base)) {
    duplicatedFrom = base;
    let n = 2;
    while (taken(`${base}-COPY${n}`)) n += 1;
    sku = `${base}-COPY${n}`;
    display = `${displaySku}-副本${n}`;
  }

  const now = new Date().toISOString();
  /* options 只在「带来源的批量导入」里传（目前是合同清洗中心的入库）：
       sourceContract —— 价格出处，只记合同**文件名**（Wayne 2026-09-16：不记路径、不记任务号）
       parseMethod    —— 'manual' | 'rules' | 'ai'，用来区分这条货号是手录还是合同带进来的
       currency       —— 新建时按合同的币种落库；不传仍然是 CNY（产品库原有口径）
     ⚠️ 更新已有货号时**不动 currency** —— 汇率口径牵一发动全身，不在这里顺手改。 */
  const sourceContract = options.sourceContract || null;
  const parseMethod = options.parseMethod || 'manual';
  const currency = String(options.currency || 'CNY').toUpperCase();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO products (sku, display_sku, name, spec, price, currency, moq, description,
                             supplier_id, contract_id, group_id, parse_method,
                             last_updated, source_contract, confidence,
                             uploader, org_id, duplicated_from, created_at, updated_at)
       VALUES (@sku, @display_sku, @name, @spec, @price, @currency, @moq, @description,
               @supplier_id, NULL, @group_id, @parse_method, @now, @source_contract, 'high',
               @uploader, @org_id, @duplicated_from, @now, @now)`
    ).run({
      sku,
      display_sku: display,
      name: b.name?.trim() || null,
      spec: b.spec?.trim() || null,
      price: v.price,
      moq: v.moq,
      currency,
      description: b.description?.trim() || null,
      supplier_id: supplierId,
      group_id: groupId,
      parse_method: parseMethod,
      source_contract: sourceContract,
      now,
      uploader: actor,
      org_id: actorOrg,
      duplicated_from: duplicatedFrom
    });
    /* 手工价格同样留痕，保证「每个价格都能追到出处」这条不破功。
       带来源时（合同入库）把合同文件名当出处写进去，手工录入才写「手工录入」。 */
    if (v.price !== null) {
      db.prepare(
        `INSERT INTO price_history (sku, old_price, new_price, old_moq, new_moq, currency,
                                    supplier_id, source_contract, confidence, changed_at, changed_by)
         VALUES (@sku, NULL, @price, NULL, @moq, @currency, @supplier_id, @source_contract, 'high', @now, @changed_by)`
      ).run({
        sku,
        price: v.price,
        moq: v.moq,
        currency,
        supplier_id: supplierId,
        source_contract: sourceContract || '手工录入',
        now,
        changed_by: actor
      });
    }
  })();

  if (Array.isArray(b.attributes)) replaceAttrs({ sku }, b.attributes);
  return { sku, displaySku: display, duplicatedFrom };
}

/* ------------------------------- 产品解析 ------------------------------- */

/**
 * 解析货号，返回统一的 { product, packaging } 视图。
 *
 * 合并前这里要先打 SKU 服务、失败再回退本地镜像（镜像只兜底，绝不拿过期价去报价）。
 * 现在数据就在本库，直接查即可 —— 单表主键命中，比原来走一趟 HTTP 快得多。
 * packaging 始终取自本地 product_packaging（询盘/报价用的包装快照来源）。
 */
function resolveProduct(sku) {
  const raw = String(sku || '').trim();
  if (!raw) throw new Error('SKU 不能为空');

  const key = normalizeSku(raw);
  const row = db.prepare(
    `SELECT p.*, s.name AS supplier_name FROM products p
     LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.sku = ?`
  ).get(key);
  if (!row) throw new Error(`产品 SKU 不存在：${raw}`);

  const product = {
    ...row,
    sku: row.sku,
    display_sku: row.display_sku || row.sku,
    name: row.name || row.name_en || row.sku,
    name_en: row.name_en || null,
    price: row.price,
    currency: row.currency || 'CNY',
    moq: row.moq === undefined ? null : row.moq
  };
  const packaging = db.prepare('SELECT * FROM product_packaging WHERE sku = ?').get(row.sku) || null;
  return { product, packaging };
}

module.exports = {
  normalizeSku,
  groupKey,
  mimeFor,
  storeImage,
  getImage,
  deleteImage,
  deleteImagesFor,
  storeContractFile,
  getContractFile,
  getItemAttrs,
  getGroupAttrs,
  replaceAttrs,
  cleanupGroupIfEmpty,
  validatePriceMoq,
  insertItem,
  resolveProduct
};
