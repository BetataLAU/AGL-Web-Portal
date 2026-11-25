// ===== HKIA CDP：測試情境範本（Preset Scenarios）=====
// 一鍵產生符合 Spec 形狀的 payload：唯一 documentId（UUID v4）、未來時間戳（RFC 3339 +08:00）。
// 這些 payload 同時被「Full Flow / Lite Flow 表單」與「Learning Hub 沙盒」使用。

export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// RFC 3339（香港時區 +08:00），例：2026-11-25T14:30:00+08:00
export function nowRfc3339() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+08:00`;
}

// 未來 3 小時（避免 SIT 時間窗驗證失敗）
export function futureRfc3339(hours = 3) {
  return nowRfc3339WithOffset(hours * 3600);
}

function nowRfc3339WithOffset(offsetSeconds) {
  const d = new Date(Date.now() + offsetSeconds * 1000 + 8 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+08:00`;
}

// 「AKE12345AK|AKE|SUB|4.25|950.5」每行一個 ULD
export function parseUldLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('|').map((p) => p.trim());
      const [uldNumber = '', contour = '', subcontour = '', volume = '', weight = ''] = parts;
      return {
        uldNumber,
        contour: contour.toUpperCase(),
        subcontour: subcontour.toUpperCase(),
        volume: volume === '' ? undefined : { value: Number(volume), unit: 'CBM' },
        weight: weight === '' ? undefined : { value: Number(weight), unit: 'KG' }
      };
    });
}

export function formatUldLines(ulds) {
  return (Array.isArray(ulds) ? ulds : []).map((u) => {
    const vol = u && u.volume && u.volume.value !== undefined ? u.volume.value : '';
    const wt = u && u.weight && u.weight.value !== undefined ? u.weight.value : '';
    return [u.uldNumber || '', u.contour || '', u.subcontour || '', vol, wt].join('|');
  }).join('\n');
}

function base(overrides) {
  return Object.assign({
    documentId: uuid(),
    ctoCode: 'AAT',
    cargoType: 'BUK',
    airlineCode: 'CX',
    mawbNumber: '160-1234 5678',
    hawbNumber: 'HAWB0001',
    destination: 'HKG',
    flightNumber: 'CX880',
    flightDate: futureRfc3339(3),
    raCode: 'RA12345',
    rfCode: 'RF12345',
    racsfCode: 'RACSF001',
    screeningMethod: 'RACSF',
    securityStatus: { statusCode: 'SPX', screeningMethod: 'RACSF' },
    vehicleRegistration: 'AB1234',
    sealType: 'BOX_TRUCK_V2',
    seal: 'SEAL-0001',
    additionalSecurityInformation: 'SCREENED BY X-RAY AT RACSF.',
    receipt: { emails: ['ops@example.com'] },
    specialHandlingCodes: [],
    cargo: { pieceCount: 10, weight: { value: 950.5, unit: 'KG' }, volume: { value: 4.25, unit: 'CBM' } },
    ulds: [{ uldNumber: 'AKE12345AK', contour: 'AKE', subcontour: '', volume: { value: 4.25, unit: 'CBM' }, weight: { value: 950.5, unit: 'KG' } }],
    piCode: '',
    piCodeBooking: '',
    buUserName: '',
    discNoticeYn: false,
    natureOfGoods: 'GENERAL CARGO'
  }, overrides || {});
}

export const PRESETS = [
  {
    id: 'bulk_aat',
    label: 'Bulk → AAT',
    api: '#405',
    cto: 'AAT',
    cargoType: 'BUK',
    note: '單一 ULD；AAT 需要 securityStatus.statusCode 與車牌。',
    build: () => base({
      ctoCode: 'AAT', cargoType: 'BUK', screeningMethod: 'RACSF',
      securityStatus: { statusCode: 'SPX', screeningMethod: 'RACSF' },
      additionalSecurityInformation: 'SCREENED BY X-RAY AT RACSF.'
    })
  },
  {
    id: 'bulk_cpsl',
    label: 'Bulk → CPSL',
    api: '#405',
    cto: 'CPSL',
    cargoType: 'BUK',
    note: 'CPSL：CX + BUK 需要 raCode / rfCode；seal 最長 30。',
    build: () => base({
      ctoCode: 'CPSL', cargoType: 'BUK', airlineCode: 'CX',
      seal: 'CX-SEAL-0001',
      additionalSecurityInformation: 'XRAY SCREENED'
    })
  },
  {
    id: 'bulk_hactl',
    label: 'Bulk → HACTL',
    api: '#405',
    cto: 'HACTL',
    cargoType: 'BUK',
    note: 'HACTL：重量 1 位小數、體積 2 位小數、ASI 全大寫 ≤60、車牌 ≤8。',
    build: () => base({
      ctoCode: 'HACTL', cargoType: 'BUK', airlineCode: 'CX',
      vehicleRegistration: 'AB1234',
      sealType: 'BOX_TRUCK_V2', seal: 'HACTL-SEAL-01',
      additionalSecurityInformation: 'SCREENED AT RACSF BY X-RAY.'
    })
  },
  {
    id: 'prepack_multi_uld',
    label: 'Prepack（多 ULD）',
    api: '#405',
    cto: 'HACTL',
    cargoType: 'PPK',
    note: 'HACTL PPK 使用 CTO 安檢（RACSF 僅限 1 個 ULD）。',
    build: () => base({
      ctoCode: 'HACTL', cargoType: 'PPK', screeningMethod: 'CTO',
      securityStatus: { statusCode: 'SPX', screeningMethod: 'CTO' },
      sealType: 'ULD_METAL_DOOR_V2', seal: 'S01,S02',
      ulds: [
        { uldNumber: 'AKE12345AK', contour: 'AKE', subcontour: '', volume: { value: 4.25, unit: 'CBM' }, weight: { value: 950.5, unit: 'KG' } },
        { uldNumber: 'PMC12345CX', contour: 'PMC', subcontour: '', volume: { value: 12.5, unit: 'CBM' }, weight: { value: 2100.5, unit: 'KG' } },
        { uldNumber: 'PAG12345CX', contour: 'PGA', subcontour: 'PGA-01', volume: { value: 9.75, unit: 'CBM' }, weight: { value: 1800, unit: 'KG' } }
      ]
    })
  },
  {
    id: 'mixprepack',
    label: 'Mix-prepack（多 MAWB + ULD）',
    api: '#405',
    cto: 'CPSL',
    cargoType: 'MIX',
    note: 'CPSL MIX：鋰電池 SPL 需 piCode / piCodeBooking / 件數 / 重量。',
    build: () => base({
      ctoCode: 'CPSL', cargoType: 'MIX', airlineCode: 'CX', screeningMethod: 'RACSF',
      securityStatus: { statusCode: 'SPX', screeningMethod: 'RACSF' },
      specialHandlingCodes: ['ELI'],
      piCode: 'PI967(II)', piCodeBooking: 'PI967(II)',
      mawbs: [{ mawbNumber: '160-1234 5678', pieceCount: 6 }, { mawbNumber: '160-8765 4321', pieceCount: 4 }],
      ulds: [
        { uldNumber: 'AKE12345AK', contour: 'AKE', subcontour: '', volume: { value: 4.25, unit: 'CBM' }, weight: { value: 950.5, unit: 'KG' } },
        { uldNumber: 'PMC12345CX', contour: 'PMC', subcontour: '', volume: { value: 12.5, unit: 'CBM' }, weight: { value: 2100.5, unit: 'KG' } }
      ],
      additionalSecurityInformation: 'LITHIUM BATTERY SCREENED'
    })
  },
  {
    id: 'lite_aat_cto',
    label: 'Lite → AAT（CTO 安檢）',
    api: '#415',
    cto: 'AAT',
    cargoType: 'BUK',
    note: 'AAT #415：screeningMethod=CTO 時 natureOfGoods 必填（0-9 A-Z - . 空白）。',
    build: () => base({
      ctoCode: 'AAT', cargoType: 'BUK', screeningMethod: 'CTO',
      securityStatus: { statusCode: 'SCO', screeningMethod: 'CTO' },
      natureOfGoods: 'GENERAL CARGO',
      ulds: []
    })
  },
  {
    id: 'lite_aat_integrator',
    label: 'Lite → AAT（Integrator）',
    api: '#415',
    cto: 'AAT',
    cargoType: 'MIX',
    note: 'Integrator 模式同樣需要 natureOfGoods；不合法字元會被本平台預檢擋下。',
    build: () => base({
      ctoCode: 'AAT', cargoType: 'MIX', screeningMethod: 'INTEGRATOR',
      securityStatus: { statusCode: 'SPX', screeningMethod: 'INTEGRATOR' },
      natureOfGoods: 'CONSOLIDATED CARGO 01.',
      ulds: []
    })
  },
  {
    id: 'lite_hactl',
    label: 'Lite → HACTL',
    api: '#415',
    cto: 'HACTL',
    cargoType: 'BUK',
    note: 'HACTL Lite：仍需 vehicleRegistration / raCode / rfCode / ASI 全大寫。',
    build: () => base({
      ctoCode: 'HACTL', cargoType: 'BUK', screeningMethod: 'RACSF',
      securityStatus: { statusCode: 'SPX', screeningMethod: 'RACSF' },
      additionalSecurityInformation: 'LITE CARGO SCREENED.',
      ulds: []
    })
  }
];

export function getPreset(id) {
  return PRESETS.find((p) => p.id === id) || PRESETS[0];
}

// 由 Export Order 建立 #401 預報關單 payload（沿用單號與貨物資料）
export function buildPreDeclarationPayload(exportOrder, options = {}) {
  const src = exportOrder && typeof exportOrder === 'object' ? exportOrder : {};
  return Object.assign({}, src, {
    documentId: options.documentId || uuid(),
    preDeclarationType: options.preDeclarationType || 'P',
    exportOrderReferenceNum: options.exportOrderReferenceNum || '',
    ra_reference_id: '',
    cto_predeclaration_num: '',
    declaredAt: nowRfc3339()
  });
}

// 由 Export Order 建立 #409 安檢影像 payload
export function buildScreeningImagePayload(exportOrder, image, options = {}) {
  const src = exportOrder && typeof exportOrder === 'object' ? exportOrder : {};
  const img = image || {};
  return {
    exportOrderReferenceNum: options.exportOrderReferenceNum || '',
    documentId: uuid(),
    ctoCode: src.ctoCode || '',
    mawbNumber: src.mawbNumber || '',
    screeningMethod: src.screeningMethod || 'RACSF',
    imageName: img.name || 'screening.jpg',
    imageContentType: img.contentType || 'image/jpeg',
    imageBase64: img.base64 || '',
    imageHash: '',
    imageSignature: '',
    capturedAt: nowRfc3339()
  };
}
