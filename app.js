const { jsPDF } = window.jspdf;

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const SHEETS = {
  portrait: { widthMm: 210, heightMm: 297, label: "A4 竖版" },
  landscape: { widthMm: 297, heightMm: 210, label: "A4 横版" },
};

const state = {
  orientation: "portrait",
  items: [null, null],
  selectedIndex: 0,
  drag: null,
};

const refs = {
  stage: document.getElementById("stage"),
  status: document.getElementById("status"),
  pageControls: document.getElementById("page-controls"),
  inputs: [
    document.getElementById("file-input-0"),
    document.getElementById("file-input-1"),
  ],
  portraitButton: document.getElementById("sheet-portrait"),
  landscapeButton: document.getElementById("sheet-landscape"),
  presetHalf: document.getElementById("preset-half"),
  presetA5: document.getElementById("preset-a5"),
  presetReset: document.getElementById("preset-reset"),
  exportButton: document.getElementById("export-pdf"),
  template: document.getElementById("page-control-template"),
};

function getSheet() {
  return SHEETS[state.orientation];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setStatus(message, tone = "warn") {
  refs.status.textContent = message;
  refs.status.className = `status ${tone}`;
}

function mmToStageX(mm) {
  return (mm / getSheet().widthMm) * refs.stage.clientWidth;
}

function mmToStageY(mm) {
  return (mm / getSheet().heightMm) * refs.stage.clientHeight;
}

function pxToMmX(px) {
  return (px / refs.stage.clientWidth) * getSheet().widthMm;
}

function pxToMmY(px) {
  return (px / refs.stage.clientHeight) * getSheet().heightMm;
}

function getItemBounds(item) {
  const rotated = item.rotation % 180 !== 0;
  return {
    widthMm: rotated ? item.heightMm : item.widthMm,
    heightMm: rotated ? item.widthMm : item.heightMm,
  };
}

function getItemCenterMm(item) {
  const bounds = getItemBounds(item);
  return {
    xMm: item.xMm + bounds.widthMm / 2,
    yMm: item.yMm + bounds.heightMm / 2,
  };
}

function getDefaultFileLabel(index) {
  return `页面 ${index + 1}`;
}

function getLoadedItems() {
  return state.items.filter(Boolean);
}

function hasAnyItemsLoaded() {
  return getLoadedItems().length > 0;
}

async function fileToImageCanvas(file) {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const bytes = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2.2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({
      canvasContext: canvas.getContext("2d"),
      viewport,
    }).promise;
    return { canvas, sourceType: "pdf" };
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d").drawImage(image, 0, 0);
    return { canvas, sourceType: "image" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function blobToRenderable(blob, name = "远程文件") {
  const file = new File([blob], name, { type: blob.type || "application/octet-stream" });
  return fileToImageCanvas(file);
}

async function loadFile(index, file) {
  const { canvas, sourceType } = await fileToImageCanvas(file);
  applyLoadedAsset(index, canvas, sourceType, file.name);
}

function applyLoadedAsset(index, canvas, sourceType, fileName) {
  const aspect = canvas.width / canvas.height;
  state.items[index] = {
    index,
    fileName,
    sourceType,
    sourceCanvas: canvas,
    aspect,
    xMm: 12,
    yMm: 12,
    widthMm: 105,
    heightMm: 105 / aspect,
    rotation: 0,
    zIndex: index + 1,
  };

  applyHalfPreset();
  render();
  setStatus("文件已载入，可以直接拖动微调。", "ok");
}

async function loadRemoteAsset(index, url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  const blob = await response.blob();
  const fileName = decodeURIComponent(url.split("/").pop() || `远程文件${index + 1}`);
  const { canvas, sourceType } = await blobToRenderable(blob, fileName);
  applyLoadedAsset(index, canvas, sourceType, fileName);
}

function ensureItemsLoaded() {
  return state.items.every(Boolean);
}

function normalizeZIndices() {
  const ordered = [...state.items].filter(Boolean).sort((a, b) => a.zIndex - b.zIndex);
  ordered.forEach((item, order) => {
    item.zIndex = order + 1;
  });
}

function selectItem(index) {
  state.selectedIndex = index;
  render();
}

function updateOrientation(orientation) {
  state.orientation = orientation;
  const sheet = getSheet();
  refs.stage.style.aspectRatio = `${sheet.widthMm} / ${sheet.heightMm}`;
  render();
}

function applyHalfPreset() {
  const loadedItems = getLoadedItems();
  if (!loadedItems.length) {
    render();
    return;
  }

  state.orientation = "portrait";
  const sheet = getSheet();
  const targetWidth = 105;
  loadedItems.forEach((item, order) => {
    item.rotation = 0;
    item.widthMm = targetWidth;
    item.heightMm = targetWidth / item.aspect;
    item.xMm = (sheet.widthMm - item.widthMm) / 2;
    item.yMm =
      loadedItems.length === 1
        ? (sheet.heightMm - item.heightMm) / 2
        : order === 0
          ? 10
          : sheet.heightMm / 2 + 6;
  });
  normalizeZIndices();
  updateOrientation("portrait");
  setStatus("已套用上下半页预设。", "ok");
}

function applyA5Preset() {
  const loadedItems = getLoadedItems();
  if (!loadedItems.length) {
    render();
    return;
  }

  state.orientation = "landscape";
  loadedItems.forEach((item, order) => {
    item.rotation = 0;
    item.widthMm = 148.5;
    item.heightMm = 148.5 / item.aspect;
    item.xMm = loadedItems.length === 1 ? (297 - item.widthMm) / 2 : order === 0 ? 0 : 148.5;
    item.yMm = (210 - item.heightMm) / 2;
  });
  normalizeZIndices();
  updateOrientation("landscape");
  setStatus("已套用 A5 并排预设。", "ok");
}

function resetLayout() {
  if (state.orientation === "landscape") {
    applyA5Preset();
  } else {
    applyHalfPreset();
  }
}

function fitItemInsideSheet(item) {
  const sheet = getSheet();
  const bounds = getItemBounds(item);
  item.xMm = clamp(item.xMm, 0, Math.max(0, sheet.widthMm - bounds.widthMm));
  item.yMm = clamp(item.yMm, 0, Math.max(0, sheet.heightMm - bounds.heightMm));
}

function updateItemScale(index, percent) {
  const item = state.items[index];
  if (!item) {
    return;
  }

  const scale = percent / 100;
  item.widthMm = 210 * scale;
  item.heightMm = item.widthMm / item.aspect;
  fitItemInsideSheet(item);
  render();
}

function rotateItem(index) {
  const item = state.items[index];
  if (!item) {
    return;
  }
  item.rotation = (item.rotation + 90) % 360;
  fitItemInsideSheet(item);
  render();
}

function bringToFront(index) {
  const item = state.items[index];
  if (!item) {
    return;
  }
  item.zIndex = Math.max(...state.items.filter(Boolean).map((entry) => entry.zIndex)) + 1;
  normalizeZIndices();
  render();
}

function removeItem(index) {
  state.items[index] = null;
  refs.inputs[index].value = "";

  if (state.drag?.index === index) {
    state.drag = null;
  }

  const remainingItem = state.items.find(Boolean);
  state.selectedIndex = remainingItem ? remainingItem.index : 0;

  render();
  setStatus(
    remainingItem
      ? `${getDefaultFileLabel(index)} 已删除，剩余页面可以继续调整或导出。`
      : "页面已删除，请重新上传文件。",
    remainingItem ? "ok" : "warn"
  );
}

function buildPageControls() {
  refs.pageControls.innerHTML = "";
  state.items.forEach((item, index) => {
    if (!item) {
      const empty = document.createElement("div");
      empty.className = "page-card";
      empty.innerHTML = `<div class="page-name">${getDefaultFileLabel(index)}</div><div class="page-meta">尚未上传文件</div>`;
      refs.pageControls.appendChild(empty);
      return;
    }

    const fragment = refs.template.content.cloneNode(true);
    const root = fragment.querySelector(".page-card");
    root.querySelector(".page-name").textContent = getDefaultFileLabel(index);
    root.querySelector(".page-meta").textContent = item.fileName;

    const scaleInput = root.querySelector(".scale-input");
    const scaleValue = root.querySelector(".scale-value");
    const currentPercent = Math.round((item.widthMm / 210) * 100);
    scaleInput.value = currentPercent;
    scaleValue.textContent = `${currentPercent}%`;

    scaleInput.addEventListener("input", (event) => {
      scaleValue.textContent = `${event.target.value}%`;
      updateItemScale(index, Number(event.target.value));
    });

    root.querySelector(".select-button").addEventListener("click", () => selectItem(index));
    root.querySelector(".rotate-button").addEventListener("click", () => rotateItem(index));
    root.querySelector(".front-button").addEventListener("click", () => bringToFront(index));
    root.querySelector(".delete-button").addEventListener("click", () => removeItem(index));

    refs.pageControls.appendChild(fragment);
  });
}

function createStageItem(item) {
  const node = document.createElement("div");
  node.className = "stage-item";
  if (state.selectedIndex === item.index) {
    node.classList.add("selected");
  }

  node.dataset.index = item.index;
  node.dataset.label = getDefaultFileLabel(item.index);
  node.style.zIndex = String(item.zIndex);

  const bounds = getItemBounds(item);
  node.style.width = `${mmToStageX(bounds.widthMm)}px`;
  node.style.height = `${mmToStageY(bounds.heightMm)}px`;
  node.style.left = `${mmToStageX(item.xMm)}px`;
  node.style.top = `${mmToStageY(item.yMm)}px`;

  const previewShell = document.createElement("div");
  previewShell.className = "preview-shell";
  previewShell.style.width = `${mmToStageX(item.widthMm)}px`;
  previewShell.style.height = `${mmToStageY(item.heightMm)}px`;
  previewShell.style.transform = `translate(-50%, -50%) rotate(${item.rotation}deg)`;

  const preview = item.sourceCanvas.cloneNode(true);
  preview.width = item.sourceCanvas.width;
  preview.height = item.sourceCanvas.height;
  preview.getContext("2d").drawImage(item.sourceCanvas, 0, 0);
  previewShell.appendChild(preview);
  node.appendChild(previewShell);

  const handle = document.createElement("div");
  handle.className = "resize-handle";
  node.appendChild(handle);

  node.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    selectItem(item.index);
    const mode = event.target === handle ? "resize" : "drag";
    const stageRect = refs.stage.getBoundingClientRect();
    state.drag = {
      index: item.index,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startItem: {
        xMm: item.xMm,
        yMm: item.yMm,
        widthMm: item.widthMm,
        heightMm: item.heightMm,
      },
      stageRect,
    };
    node.setPointerCapture(event.pointerId);
  });

  return node;
}

function renderStage() {
  refs.stage.querySelectorAll(".stage-item").forEach((node) => node.remove());
  const items = [...state.items].filter(Boolean).sort((a, b) => a.zIndex - b.zIndex);
  items.forEach((item) => {
    refs.stage.appendChild(createStageItem(item));
  });
}

function render() {
  refs.stage.style.aspectRatio = `${getSheet().widthMm} / ${getSheet().heightMm}`;
  buildPageControls();
  renderStage();
}

async function tryLoadFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const src1 = params.get("src1");
  const src2 = params.get("src2");
  if (!src1 && !src2) {
    return;
  }

  setStatus("正在加载示例文件...", "ok");
  try {
    if (src1) {
      await loadRemoteAsset(0, src1);
    }
    if (src2) {
      await loadRemoteAsset(1, src2);
    }
    setStatus("示例文件已载入，可以直接调位置后导出。", "ok");
  } catch (error) {
    console.error(error);
    setStatus("示例文件载入失败，请改用手动上传。", "warn");
  }
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

async function exportPdf() {
  const loadedItems = getLoadedItems();
  if (!loadedItems.length) {
    setStatus("请先上传至少一页文件再导出。", "warn");
    return;
  }

  setStatus("正在生成 PDF...", "ok");
  const sheet = getSheet();
  const portrait = state.orientation === "portrait";
  const widthPx = portrait ? 2480 : 3508;
  const heightPx = portrait ? 3508 : 2480;
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = widthPx;
  exportCanvas.height = heightPx;
  const ctx = exportCanvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, widthPx, heightPx);

  for (const item of loadedItems.sort((a, b) => a.zIndex - b.zIndex)) {
    const w = (item.widthMm / sheet.widthMm) * widthPx;
    const h = (item.heightMm / sheet.heightMm) * heightPx;
    const centerMm = getItemCenterMm(item);
    const centerX = (centerMm.xMm / sheet.widthMm) * widthPx;
    const centerY = (centerMm.yMm / sheet.heightMm) * heightPx;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate((item.rotation * Math.PI) / 180);
    ctx.drawImage(item.sourceCanvas, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  const pdf = new jsPDF({
    orientation: portrait ? "portrait" : "landscape",
    unit: "mm",
    format: "a4",
    compress: true,
  });

  pdf.addImage(exportCanvas, "PNG", 0, 0, sheet.widthMm, sheet.heightMm, undefined, "FAST");
  const blob = pdf.output("blob");
  downloadBlob(blob, "a4-merge-export.pdf");
  setStatus("PDF 已导出。", "ok");
}

function handlePointerMove(event) {
  if (!state.drag) {
    return;
  }

  const item = state.items[state.drag.index];
  if (!item) {
    return;
  }

  const dxMm = pxToMmX(event.clientX - state.drag.startX);
  const dyMm = pxToMmY(event.clientY - state.drag.startY);

  if (state.drag.mode === "drag") {
    item.xMm = state.drag.startItem.xMm + dxMm;
    item.yMm = state.drag.startItem.yMm + dyMm;
    fitItemInsideSheet(item);
  } else {
    const rotated = item.rotation % 180 !== 0;
    const deltaBase = rotated ? dyMm : dxMm;
    const nextWidth = clamp(state.drag.startItem.widthMm + deltaBase, 42, getSheet().widthMm);
    item.widthMm = nextWidth;
    item.heightMm = nextWidth / item.aspect;
    fitItemInsideSheet(item);
  }

  render();
}

function handlePointerUp() {
  state.drag = null;
}

refs.inputs.forEach((input, index) => {
  input.addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) {
      return;
    }
    setStatus(`正在读取 ${file.name} ...`, "ok");
    try {
      await loadFile(index, file);
    } catch (error) {
      console.error(error);
      setStatus(`读取 ${file.name} 失败，请换一个文件试试。`, "warn");
    }
  });
});

refs.portraitButton.addEventListener("click", () => {
  updateOrientation("portrait");
  setStatus("已切换到 A4 竖版。", "ok");
});

refs.landscapeButton.addEventListener("click", () => {
  updateOrientation("landscape");
  setStatus("已切换到 A4 横版。", "ok");
});

refs.presetHalf.addEventListener("click", applyHalfPreset);
refs.presetA5.addEventListener("click", applyA5Preset);
refs.presetReset.addEventListener("click", resetLayout);
refs.exportButton.addEventListener("click", exportPdf);

window.addEventListener("pointermove", handlePointerMove);
window.addEventListener("pointerup", handlePointerUp);
window.addEventListener("resize", render);

render();
tryLoadFromQuery();
