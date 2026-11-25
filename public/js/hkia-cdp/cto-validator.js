// ===== HKIA CDP：CTO 欄位差異預檢引擎（前後端共用純函式）=====
// 前端以 <script> 載入後使用 window.HkiaCtoValidator；後端 routes/hkia-cdp 以 require() 載入同一支，
// 確保「畫面提示的」與「後端檢查的」一致。
// 覆蓋：HACTL（小數位／全大寫 ASI／車牌 8／seal 15／raCode・rfCode／PPK+RACSF 單 ULD／subcontour）
//       CPSL（鋰電池 PI 條件／LH・CX 條件／ASI 30／seal 30／車牌 12）
//       AAT（statusCode／車牌必填／#415 natureOfGoods／收件電郵 3／ASI 256）
//       Seal（多 Seal 類型／SECURENET_V2 等前綴與格式）
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HkiaCtoValidator = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CTOS = ['AAT', 'CPSL', 'HACTL'];
  const CARGO_TYPES = ['BUK', 'PPK', 'MIX'];
  const SECURITY_STATUS_CODES = ['SPX', 'SCO', 'UNK'];
  const LITHIUM_SPL = ['ELI', 'ELM', 'EBI', 'EBA', 'EAW'];
  const LITHIUM_PI_CODES = ['PI966(II)', 'PI967(II)', 'PI969(II)', 'PI970(II)'];
  // 需要 subcontour 的 contour（Spec 只寫「特定 contour」，可依 AAHK 通知調整）
  const CONTOUR_NEEDS_SUBCONTOUR = ['A1', 'A2', 'H2', 'H3', 'H4', 'W2', 'Q6', 'Q7', 'P1P', 'PGA', 'PLA', 'PRA', 'AMA', 'X8'];
  const MULTI_SEAL_TYPES = ['BOX_TRUCK_V2', 'ULD_METAL_DOOR_V2', 'SMARTSECNET_LD3'];
  const SEAL_FORMATS = {
    SECURENET_V2: { re: /^[A-Z0-9]{7}-\d{2}$/, hint: '7 位英數 +「-」+ 2 位數字（例：1234567-01）' },
    SMARTSECNET_V2: { re: /^HK[A-Z0-9-]+$/, hint: '必須以 HK 開頭' },
    EASYPACK_V2: { re: /^EP[A-Z0-9-]+$/, hint: '必須以 EP 開頭' },
    AERO_NET: { re: /^AN[A-Z0-9-]+$/, hint: '必須以 AN 開頭' },
    ADVANCE_PACK_SECURITY_SYSTEM: { re: /^AP[A-Z0-9-]+$/, hint: '必須以 AP 開頭' }
  };
  const SEAL_TYPES = Object.keys(SEAL_FORMATS).concat(MULTI_SEAL_TYPES);

  // ---------- 小工具 ----------
  const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
  const text = (v) => (v === undefined || v === null ? '' : String(v));
  const upper = (v) => text(v).trim().toUpperCase();
  const toNum = (v) => {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const decimalsOf = (v) => {
    const s = text(v).trim();
    if (!s || s.indexOf('.') === -1) return 0;
    return s.split('.')[1].replace(/0+$/, '').length;
  };

  // 深度最多 4 層，收集「欄位名稱看起來是重量／體積」的數值
  function collectNumbers(node, keyRe, out, depth) {
    if (depth > 4 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item) => collectNumbers(item, keyRe, out, depth + 1));
      return;
    }
    Object.keys(node).forEach((key) => {
      const val = node[key];
      if (keyRe.test(key)) {
        if (typeof val === 'number' || typeof val === 'string') {
          const n = toNum(val);
          if (n !== null) out.push({ key, value: n, text: text(val) });
        } else if (val && typeof val === 'object' && 'value' in val) {
          const n = toNum(val.value);
          if (n !== null) out.push({ key, value: n, text: text(val.value) });
        }
      }
      collectNumbers(val, keyRe, out, depth + 1);
    });
  }

  function collectEmails(node, out, depth) {
    if (depth > 4 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item) => collectEmails(item, out, depth + 1));
      return;
    }
    Object.keys(node).forEach((key) => {
      const val = node[key];
      if (/e-?mail/i.test(key)) {
        if (Array.isArray(val)) val.forEach((x) => { if (!isBlank(x)) out.push(String(x)); });
        else if (typeof val === 'string' && val.indexOf('@') !== -1) out.push(val);
        else if (val && typeof val === 'object') collectEmails(val, out, depth + 1);
      }
      collectEmails(val, out, depth + 1);
    });
  }


  // 收斂各種 payload 命名（Export Order / Pre-declaration / Lite）
  function normalize(payload) {
    const raw = payload && typeof payload === 'object' ? payload : {};
    const inner = raw.exportOrder || raw.preDeclaration || raw.litePreDeclaration || raw.data || {};
    const p = Object.assign({}, raw, inner && typeof inner === 'object' ? inner : {});
    const cargo = (p.cargo && typeof p.cargo === 'object') ? p.cargo : {};
    const securityStatus = Object.assign({}, p.securityStatus && typeof p.securityStatus === 'object' ? p.securityStatus : {});
    const ulds = Array.isArray(p.ulds) ? p.ulds : (Array.isArray(p.uldList) ? p.uldList : []);
    const weights = [];
    const volumes = [];
    collectNumbers(raw, /weight/i, weights, 0);
    collectNumbers(raw, /^(volume|cbm)$/i, volumes, 0);
    const emails = [];
    collectEmails(raw, emails, 0);
    const spl = Array.isArray(p.specialHandlingCodes) ? p.specialHandlingCodes.map(upper) : [];
    return {
      raw,
      p,
      cargo,
      securityStatus,
      ulds,
      weights,
      volumes,
      emails,
      spl,
      cto: upper(p.ctoCode || p.cto),
      cargoType: upper(p.cargoType),
      airlineCode: upper(p.airlineCode),
      screeningMethod: upper(p.screeningMethod || securityStatus.screeningMethod),
      mawb: text(p.mawbNumber || p.mawb || p.masterAirWaybillNumber),
      raCode: text(p.raCode),
      rfCode: text(p.rfCode),
      vehicleRegistration: text(p.vehicleRegistration || (p.truck && p.truck.vehicleRegistration)),
      additionalSecurityInformation: text(p.additionalSecurityInformation),
      sealType: upper(p.sealType || p.sealTypeCode),
      seal: text(p.seal || p.sealNumber || p.sealNo),
      natureOfGoods: text(p.natureOfGoods),
      piCode: upper(p.piCode),
      piCodeBooking: upper(p.piCodeBooking),
      buUserName: text(p.buUserName),
      discNoticeYn: p.discNoticeYn === true || upper(p.discNoticeYn) === 'Y' || upper(p.discNoticeYn) === 'TRUE',
      pieceCount: toNum(cargo.pieceCount !== undefined ? cargo.pieceCount : p.pieceCount),
      cargoWeight: toNum(cargo.weight && cargo.weight.value !== undefined ? cargo.weight.value : p.weightValue)
    };
  }

  // ---------- 各 CTO 規則 ----------
  function checkHactl(ctx, errors, warnings) {
    ctx.volumes.forEach((v) => {
      if (decimalsOf(v.text) > 2) {
        errors.push({ code: '108785', field: v.key, level: 'error', message: `HACTL 體積最多 2 位小數（目前 ${v.text}）`, hint: '請四捨五入到 2 位小數，例如 4.25。' });
      }
    });
    ctx.weights.forEach((w) => {
      if (decimalsOf(w.text) > 1) {
        errors.push({ code: '108717', field: w.key, level: 'error', message: `HACTL 重量最多 1 位小數（目前 ${w.text}）`, hint: '請四捨五入到 1 位小數，例如 950.5。' });
      }
    });
    const asi = ctx.additionalSecurityInformation;
    if (asi.length > 60) {
      errors.push({ code: '122090', field: 'additionalSecurityInformation', level: 'error', message: `HACTL additionalSecurityInformation 限 60 字元（目前 ${asi.length}）` });
    }
    if (asi && asi !== asi.toUpperCase()) {
      errors.push({ code: '122090', field: 'additionalSecurityInformation', level: 'error', message: 'HACTL additionalSecurityInformation 必須全大寫英文', hint: '例：SCREENED BY X-RAY AT RACSF.' });
    }
    if (!ctx.vehicleRegistration) {
      errors.push({ code: 'HACTL_VEHICLE_REQUIRED', field: 'vehicleRegistration', level: 'error', message: 'HACTL 必須填寫 vehicleRegistration（車牌）' });
    } else if (ctx.vehicleRegistration.length > 8) {
      errors.push({ code: 'HACTL_VEHICLE_LEN', field: 'vehicleRegistration', level: 'error', message: `HACTL vehicleRegistration 限 8 字元（目前 ${ctx.vehicleRegistration.length}）` });
    }
    if (ctx.seal && ctx.seal.length > 15) {
      errors.push({ code: 'HACTL_SEAL_LEN', field: 'seal', level: 'error', message: `HACTL seal 限 15 字元（目前 ${ctx.seal.length}）` });
    }
    if (!ctx.raCode) errors.push({ code: 'HACTL_RA_REQUIRED', field: 'raCode', level: 'error', message: 'HACTL 必須填寫 raCode' });
    if (!ctx.rfCode) errors.push({ code: 'HACTL_RF_REQUIRED', field: 'rfCode', level: 'error', message: 'HACTL 必須填寫 rfCode' });
    if (ctx.cargoType === 'PPK' && ctx.screeningMethod === 'RACSF' && ctx.ulds.length > 1) {
      errors.push({ code: 'HACTL_PPK_RACSF_ULD', field: 'ulds', level: 'error', message: `HACTL PPK + RACSF 只允許 1 個 ULD（目前 ${ctx.ulds.length} 個）` });
    }
    ctx.ulds.forEach((uld, idx) => {
      const contour = upper(uld && (uld.contour || uld.contourCode));
      const sub = text(uld && (uld.subcontour || uld.subContour));
      if (contour && CONTOUR_NEEDS_SUBCONTOUR.indexOf(contour) !== -1 && !sub) {
        errors.push({ code: 'HACTL_SUBCONTOUR', field: `ulds[${idx}].subcontour`, level: 'error', message: `HACTL contour「${contour}」必須填寫 subcontour` });
      }
    });
    if (asi && asi.length > 50 && asi.length <= 60) {
      warnings.push({ code: 'HACTL_ASI_NEAR_LIMIT', field: 'additionalSecurityInformation', level: 'warn', message: 'additionalSecurityInformation 接近 60 字元上限，請確認 CTO 可接受。' });
    }
  }

  function checkCpsl(ctx, errors, warnings) {
    const hasLithium = ctx.spl.some((c) => LITHIUM_SPL.indexOf(c) !== -1);
    const pi = LITHIUM_PI_CODES.indexOf(ctx.piCode) !== -1;
    if (hasLithium && pi) {
      if (ctx.pieceCount === null) {
        errors.push({ code: 'CPSL_PI_PCS', field: 'cargo.pieceCount', level: 'error', message: `${ctx.piCode} 鋰電池貨物必須填寫 pieceCount` });
      }
      if (ctx.cargoWeight === null) {
        errors.push({ code: 'CPSL_PI_WEIGHT', field: 'cargo.weight.value', level: 'error', message: `${ctx.piCode} 鋰電池貨物必須填寫 weight.value` });
      }
      if ((ctx.cargoType === 'PPK' || ctx.cargoType === 'MIX') && !ctx.piCodeBooking) {
        errors.push({ code: 'CPSL_PI_BOOKING', field: 'piCodeBooking', level: 'error', message: 'CPSL PPK/MIX 鋰電池貨物必須填寫 piCodeBooking' });
      }
    }
    if (ctx.airlineCode === 'LH' && (ctx.cargoType === 'PPK' || ctx.cargoType === 'MIX')) {
      if (!ctx.buUserName) errors.push({ code: 'CPSL_LH_BU', field: 'buUserName', level: 'error', message: 'CPSL：航空公司 LH + PPK/MIX 必須填寫 buUserName' });
      if (!ctx.discNoticeYn) errors.push({ code: 'CPSL_LH_DISC', field: 'discNoticeYn', level: 'error', message: 'CPSL：航空公司 LH + PPK/MIX 必須勾選 discNoticeYn = true' });
    }
    if (ctx.airlineCode === 'CX' && (ctx.cargoType === 'BUK' || ctx.cargoType === 'PPK')) {
      if (!ctx.raCode) errors.push({ code: 'CPSL_CX_RA', field: 'raCode', level: 'error', message: 'CPSL：航空公司 CX + BUK/PPK 必須填寫 raCode' });
      if (!ctx.rfCode) errors.push({ code: 'CPSL_CX_RF', field: 'rfCode', level: 'error', message: 'CPSL：航空公司 CX + BUK/PPK 必須填寫 rfCode' });
    }
    const asi = ctx.additionalSecurityInformation;
    if (asi.length > 30) errors.push({ code: 'CPSL_ASI_LEN', field: 'additionalSecurityInformation', level: 'error', message: `CPSL additionalSecurityInformation 限 30 字元（目前 ${asi.length}）` });
    if (ctx.seal && ctx.seal.length > 30) errors.push({ code: 'CPSL_SEAL_LEN', field: 'seal', level: 'error', message: `CPSL seal 限 30 字元（目前 ${ctx.seal.length}）` });
    if (ctx.vehicleRegistration && ctx.vehicleRegistration.length > 12) errors.push({ code: 'CPSL_VEHICLE_LEN', field: 'vehicleRegistration', level: 'error', message: `CPSL vehicleRegistration 限 12 字元（目前 ${ctx.vehicleRegistration.length}）` });
    if (hasLithium && !pi) warnings.push({ code: 'CPSL_PI_MISSING', field: 'piCode', level: 'warn', message: '含鋰電池 SPL 但未填 piCode（PI966/967/969/970(II)），請確認 CTO 是否要求。' });
  }

  function checkAat(ctx, api, errors, warnings) {
    const statusCode = upper(ctx.securityStatus.statusCode);
    if (!statusCode) {
      errors.push({ code: 'AAT_STATUS_REQUIRED', field: 'securityStatus.statusCode', level: 'error', message: 'AAT 必須填寫 securityStatus.statusCode（SPX / SCO / UNK）' });
    } else if (SECURITY_STATUS_CODES.indexOf(statusCode) === -1) {
      errors.push({ code: 'AAT_STATUS_INVALID', field: 'securityStatus.statusCode', level: 'error', message: `AAT securityStatus.statusCode 只接受 SPX / SCO / UNK（目前 ${statusCode}）` });
    }
    if (!ctx.vehicleRegistration) {
      errors.push({ code: 'AAT_VEHICLE_REQUIRED', field: 'vehicleRegistration', level: 'error', message: 'AAT 必須填寫 vehicleRegistration（車牌）' });
    }
    if (api === '#415' && (ctx.screeningMethod === 'CTO' || ctx.screeningMethod === 'INTEGRATOR')) {
      if (!ctx.natureOfGoods) {
        errors.push({ code: 'AAT_NOG_REQUIRED', field: 'natureOfGoods', level: 'error', message: `AAT #415：screeningMethod=${ctx.screeningMethod} 必須填寫 natureOfGoods` });
      } else if (!/^[0-9A-Z\-.\s]+$/.test(ctx.natureOfGoods)) {
        errors.push({ code: 'AAT_NOG_CHARS', field: 'natureOfGoods', level: 'error', message: 'AAT natureOfGoods 只接受 0-9、A-Z、「-」、「.」與空白', hint: `目前：${ctx.natureOfGoods}` });
      }
    }
    if (ctx.emails.length > 3) {
      errors.push({ code: 'AAT_RECEIPT_MAX', field: 'receipt', level: 'error', message: `AAT receipt 電郵最多 3 個（目前 ${ctx.emails.length} 個）` });
    }
    const asi = ctx.additionalSecurityInformation;
    if (asi.length > 256) errors.push({ code: 'AAT_ASI_LEN', field: 'additionalSecurityInformation', level: 'error', message: `AAT additionalSecurityInformation 限 256 字元（目前 ${asi.length}）` });
    if (!ctx.mawb) warnings.push({ code: 'MAWB_MISSING', field: 'mawbNumber', level: 'warn', message: '未填 MAWB#，正式環境通常會被 CTO 拒絕（例如 108004）。' });
  }

  // ---------- Seal 格式 ----------
  function checkSeal(ctx, errors, warnings) {
    const sealType = ctx.sealType;
    const seal = ctx.seal.trim();
    if (!sealType) return;
    if (SEAL_TYPES.indexOf(sealType) === -1) {
      warnings.push({ code: 'SEAL_TYPE_UNKNOWN', field: 'sealType', level: 'warn', message: `未認得的 sealType「${sealType}」，請確認 Spec 4.21。` });
      return;
    }
    if (!seal) {
      errors.push({ code: 'SEAL_REQUIRED', field: 'seal', level: 'error', message: `sealType=${sealType} 必須填寫 seal` });
      return;
    }
    if (MULTI_SEAL_TYPES.indexOf(sealType) !== -1) {
      const parts = seal.split(',').map((s) => s.trim()).filter(Boolean);
      if (!parts.length) errors.push({ code: 'SEAL_EMPTY_PART', field: 'seal', level: 'error', message: '多 Seal 格式不可有空白項目（逗號分隔）' });
      return;
    }
    const rule = SEAL_FORMATS[sealType];
    if (rule && !rule.re.test(seal.toUpperCase())) {
      errors.push({ code: 'SEAL_FORMAT', field: 'seal', level: 'error', message: `${sealType} seal 格式不符：${rule.hint}`, hint: `目前：${seal}` });
    }
  }

  function validate(payload, options) {
    const opts = options || {};
    const ctx = normalize(payload);
    const cto = upper(opts.cto || ctx.cto);
    const cargoType = upper(opts.cargoType || ctx.cargoType);
    const api = opts.api || '';
    const errors = [];
    const warnings = [];
    let rules = 1; // Seal 格式一律檢查

    if (!ctx.mawb && api !== '#416') warnings.push({ code: 'MAWB_MISSING', field: 'mawbNumber', level: 'warn', message: '未填 MAWB#（正式環境通常必填）。' });
    if (cto && CTOS.indexOf(cto) === -1) warnings.push({ code: 'CTO_UNKNOWN', field: 'ctoCode', level: 'warn', message: `未認得的 CTO「${cto}」` });
    if (cargoType && CARGO_TYPES.indexOf(cargoType) === -1) warnings.push({ code: 'CARGO_TYPE_UNKNOWN', field: 'cargoType', level: 'warn', message: `未認得的 Cargo Type「${cargoType}」` });

    if (cto === 'HACTL') { checkHactl(ctx, errors, warnings); rules += 12; }
    else if (cto === 'CPSL') { checkCpsl(ctx, errors, warnings); rules += 10; }
    else if (cto === 'AAT') { checkAat(ctx, api, errors, warnings); rules += 8; }

    checkSeal(ctx, errors, warnings);

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      summary: { cto, cargoType, api, rulesChecked: rules, uldCount: ctx.ulds.length, weightCount: ctx.weights.length, volumeCount: ctx.volumes.length }
    };
  }

  return {
    CTOS,
    CARGO_TYPES,
    SECURITY_STATUS_CODES,
    LITHIUM_SPL,
    LITHIUM_PI_CODES,
    CONTOUR_NEEDS_SUBCONTOUR,
    MULTI_SEAL_TYPES,
    SEAL_TYPES,
    SEAL_FORMATS,
    normalize,
    validate
  };
});
