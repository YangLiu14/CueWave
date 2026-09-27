const probeData = {
  steps: {
    label: "实操步骤",
    color: "#d9ff76",
    values: [5,7,5,9,6,8,11,10,8,9,15,14,22,40,68,86,98,81,45,20,13,9,7,8,9,10,14,20,24,16,9,10,17,24,48,76,92,82,44,19,12,10,8,7,6,8,9,7],
    peaks: [16, 36],
    timestamp: "06:18",
    time: "06:18 / 24:00",
    progress: "26.25%",
    subtitle: "“我们直接看一下具体是怎么做的。”",
    detail: "从概念进入演示，开始逐步展示如何完成操作。"
  },
  knowledge: {
    label: "知识科普",
    color: "#b9a3ff",
    values: [8,9,11,14,21,37,64,83,91,72,49,27,15,11,10,9,13,17,22,20,15,12,10,8,9,14,29,51,77,93,84,61,38,21,12,10,11,15,19,24,19,14,10,9,8,7,6,7],
    peaks: [8, 29],
    timestamp: "14:24",
    time: "14:24 / 24:00",
    progress: "60%",
    subtitle: "“镜片起雾，是水汽在较冷表面凝结成了小水滴。”",
    detail: "解释了一个日常现象背后的因果关系，观众能复述具体知识点。"
  },
  specific: {
    label: "具体程度",
    color: "#72d9e4",
    values: [9,8,10,12,14,17,19,14,13,17,23,34,44,58,68,73,70,63,55,49,31,18,15,10,9,11,15,18,28,43,60,70,79,89,94,82,70,55,47,31,23,15,12,10,9,8,7,6],
    peaks: [34, 15],
    timestamp: "17:04",
    time: "17:04 / 24:00",
    progress: "71.1%",
    subtitle: "“我们测了 120 个样本，错误率降低了 18%。”",
    detail: "出现了数量、方法和结果，表达不再停留于抽象概念。"
  },
  humor: {
    label: "幽默程度",
    color: "#ff8a9a",
    values: [7,8,10,12,13,15,12,10,8,7,8,12,18,22,18,12,9,8,10,15,25,48,72,91,76,39,20,13,9,7,8,10,14,21,18,15,11,9,8,12,20,39,69,84,63,35,18,9],
    peaks: [23, 43],
    timestamp: "11:36",
    time: "11:36 / 24:00",
    progress: "48.3%",
    subtitle: "“我们把 bug 修好了——它只是换了个地方住。”",
    detail: "用意外的转折表达技术挫折，可能引发轻松的笑声。"
  }
};

const heatmap = document.querySelector("#heatmap");
const chips = [...document.querySelectorAll(".probe-chip")];
const resultTimestamp = document.querySelector("#result-timestamp");
const resultText = document.querySelector("#result-text");
const demoTime = document.querySelector("#demo-time");
const demoProgress = document.querySelector("#demo-progress");
const demoSubtitle = document.querySelector("#demo-subtitle");
let activeProbe = "steps";

function drawHeatmap() {
  if (!heatmap) return;
  heatmap.replaceChildren();
  for (let index = 0; index < probeData.steps.values.length; index += 1) {
    const column = document.createElement("div");
    column.className = "heatmap-column";
    for (const [key, probe] of Object.entries(probeData)) {
      const bar = document.createElement("span");
      bar.className = `heatmap-bar ${key === activeProbe ? "is-highlighted" : "is-muted"}`;
      bar.style.setProperty("--height", `${probe.values[index]}%`);
      bar.style.setProperty("--bar-color", probe.color);
      column.append(bar);
    }
    if (probeData[activeProbe].peaks.includes(index)) column.classList.add("is-peak");
    heatmap.append(column);
  }
  heatmap.setAttribute("aria-label", `交互示意：当前高亮${probeData[activeProbe].label}探针的语义热力图`);
}

function selectProbe(key) {
  const probe = probeData[key];
  if (!probe) return;
  activeProbe = key;
  for (const chip of chips) {
    const selected = chip.dataset.probe === key;
    chip.style.setProperty("--active-color", probeData[chip.dataset.probe].color);
    chip.classList.toggle("is-active", selected);
    chip.setAttribute("aria-pressed", String(selected));
  }
  resultTimestamp.textContent = probe.timestamp;
  resultText.textContent = probe.detail;
  demoTime.textContent = probe.time;
  demoProgress.style.width = probe.progress;
  demoSubtitle.textContent = probe.subtitle;
  drawHeatmap();
}

for (const chip of chips) chip.addEventListener("click", () => selectProbe(chip.dataset.probe));
selectProbe(activeProbe);
