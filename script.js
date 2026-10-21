const LESSONS = [
  ["lesson-1", "训练与推理"],
  ["lesson-2", "Token、Prefill 与 Decode"],
  ["lesson-3", "一次请求的完整链路"],
  ["lesson-4", "KV Cache"],
  ["lesson-5", "调度器"],
  ["lesson-6", "DP、EP 与 CP"],
  ["lesson-7", "源码阅读顺序"],
  ["lesson-8", "迷你调度器实验"]
];

const storageKey = "deepinfer-tutorial-progress-v1";
const labKey = "deepinfer-tutorial-labs-v1";
let completed = new Set(JSON.parse(localStorage.getItem(storageKey) || "[]"));

function saveProgress() {
  localStorage.setItem(storageKey, JSON.stringify([...completed]));
  renderProgress();
}

function renderProgress() {
  const count = completed.size;
  const percent = Math.round((count / LESSONS.length) * 100);
  document.getElementById("progressText").textContent = `${count} / ${LESSONS.length}`;
  document.getElementById("progressRing").style.setProperty("--progress", `${percent}%`);
  document.getElementById("drawerMeter").style.width = `${percent}%`;
  document.getElementById("drawerSummary").textContent = `已完成 ${count} / ${LESSONS.length} 课 · ${percent}%`;

  const list = document.getElementById("progressList");
  list.innerHTML = LESSONS.map(([id, name], i) =>
    `<li class="${completed.has(id) ? "done" : ""}">${completed.has(id) ? "✓" : "○"} ${String(i + 1).padStart(2, "0")} · ${name}</li>`
  ).join("");

  document.querySelectorAll(".complete-button").forEach(button => {
    const done = completed.has(button.dataset.lesson);
    button.classList.toggle("done", done);
    button.lastChild.textContent = done ? " 已完成（点击可取消）" : button.dataset.initialLabel;
  });
}

document.querySelectorAll(".complete-button").forEach(button => {
  const initialLabel = button.lastChild.textContent;
  button.dataset.initialLabel = initialLabel;
  button.addEventListener("click", () => {
    const id = button.dataset.lesson;
    if (completed.has(id)) completed.delete(id); else completed.add(id);
    saveProgress();
    showToast(completed.has(id) ? "进度已保存 ✓" : "已取消完成状态");
  });
});

const drawer = document.getElementById("progressDrawer");
document.getElementById("progressButton").addEventListener("click", () => {
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
});
document.querySelectorAll("[data-close-drawer]").forEach(el => el.addEventListener("click", closeDrawer));
document.addEventListener("keydown", event => { if (event.key === "Escape") closeDrawer(); });
function closeDrawer() {
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
}

document.getElementById("resumeButton").addEventListener("click", () => {
  const next = LESSONS.find(([id]) => !completed.has(id)) || LESSONS[0];
  document.querySelector(`[data-lesson="${next[0]}"]`).closest("section").scrollIntoView({ behavior: "smooth" });
});

let generatedTokens = 1;
const candidateTokens = [...document.querySelectorAll(".token.candidate")];
function renderTokens() {
  candidateTokens.forEach((token, index) => {
    token.classList.toggle("active", index < generatedTokens);
    token.style.display = index <= generatedTokens ? "inline-block" : "none";
  });
  document.getElementById("tokenStatus").textContent = `已生成 ${3 + generatedTokens} / 7`;
}
document.getElementById("nextToken").addEventListener("click", () => {
  if (generatedTokens < candidateTokens.length) generatedTokens += 1;
  renderTokens();
  if (generatedTokens === candidateTokens.length) showToast("一句话生成完成！");
});
document.getElementById("resetTokens").addEventListener("click", () => { generatedTokens = 1; renderTokens(); });

const journeyData = [
  {
    file: "deepinfer/entrypoints/llm.py",
    title: "入口：把人话变成内部请求",
    desc: "LLM 类接收你的文字、生成参数和模型配置，然后创建框架能管理的请求对象。",
    question: "“用户到底想让模型做什么？”",
    code: `<span class="kw">llm</span> = LLM(model=<span class="str">"DeepSeek"</span>)\noutput = llm.generate(\n    <span class="str">"解释什么是推理"</span>\n)`
  },
  {
    file: "csrc/engine/scheduler.hpp",
    title: "调度：决定这一轮谁能上车",
    desc: "调度器查看等待请求、可用KV Cache和Token预算，选出本轮要处理的Sequence。",
    question: "“资源有限时，先服务谁、服务多少？”",
    code: `<span class="kw">while</span> waiting:\n    request = choose_next()\n    <span class="kw">if</span> fits_budget(request):\n        running.add(request)`
  },
  {
    file: "deepinfer/worker/",
    title: "执行：把任务交给GPU或NPU",
    desc: "Worker准备张量、调用模型前向计算，并在多设备环境中协调各个Rank。",
    question: "“这一步在哪个设备、用什么形状计算？”",
    code: `worker.execute_model_step(\n    sequences=batch,\n    cache=kv_blocks,\n    parallel=<span class="str">"EP"</span>\n)`
  },
  {
    file: "deepinfer/model_executor/",
    title: "采样：从候选词中选出下一个",
    desc: "模型输出每个Token的概率，采样器根据温度、Top-K等规则选择下一个Token。",
    question: "“概率最高的词，就一定要选吗？”",
    code: `logits = model.forward(batch)\nnext_token = sample(\n    logits, temperature=<span class="num">0.7</span>\n)`
  },
  {
    file: "deepinfer/engine/llm_engine.py",
    title: "输出：更新状态，再继续下一轮",
    desc: "引擎把新Token加入Sequence，判断是否结束；没结束就再次进入调度与执行循环。",
    question: "“请求完成了吗？下一步还要计算什么？”",
    code: `<span class="kw">if</span> token == EOS:\n    finish(request)\n<span class="kw">else</span>:\n    request.append(token)\n    schedule_again()`
  }
];

document.querySelectorAll(".journey-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    const index = Number(tab.dataset.step);
    document.querySelectorAll(".journey-tab").forEach(t => {
      t.classList.toggle("active", t === tab);
      t.setAttribute("aria-selected", String(t === tab));
    });
    const data = journeyData[index];
    document.getElementById("journeyFile").textContent = data.file;
    document.getElementById("journeyTitle").textContent = data.title;
    document.getElementById("journeyDesc").textContent = data.desc;
    document.getElementById("journeyQuestion").textContent = data.question;
    document.getElementById("journeyCode").innerHTML = `<code>${data.code}</code>`;
  });
});

document.querySelectorAll("[data-cache]").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-cache]").forEach(b => b.classList.toggle("active", b === button));
    const enabled = button.dataset.cache === "on";
    document.getElementById("cacheVisual").classList.toggle("cache-off", !enabled);
    document.getElementById("repeatCalc").textContent = enabled ? "少" : "很多";
    document.getElementById("generationSpeed").textContent = enabled ? "更快" : "变慢";
    document.getElementById("memoryUse").textContent = enabled ? "增加" : "较少";
    document.querySelector(".cache-arrow").textContent = enabled ? "只计算新内容 ↓" : "每次重新计算全部内容 ↓";
  });
});

let scheduled = false;
document.getElementById("scheduleButton").addEventListener("click", () => {
  scheduled = !scheduled;
  document.querySelectorAll(".mini-request").forEach((request, index) => request.classList.toggle("scheduled", scheduled && index === 0));
  document.querySelectorAll(".gpu-slots div").forEach((slot, index) => slot.classList.toggle("active", scheduled && index < 8));
  document.getElementById("schedulerMessage").textContent = scheduled
    ? "本轮预算全部分给请求A；B和C继续等待。这样吞吐不一定差，但短请求B的体验可能不好。"
    : "点击按钮，让调度器选择本轮任务。";
  document.getElementById("scheduleButton").firstChild.textContent = scheduled ? "清空这一轮 " : "安排这一轮 ";
});

const pathData = {
  normal: {
    letter: "A", title: "普通电脑学习路线",
    steps: ["先完成本站前六课，建立推理系统心智模型。", "安装Python，用本站的迷你调度器练习基础语法。", "用小模型或vLLM观察Prefill、Decode和KV Cache。", "下载DeepInfer源码，静态追踪Python调用链。", "把完整运行留到云端或合适服务器环境。"]
  },
  server: {
    letter: "B", title: "服务器实战路线",
    steps: ["确认Linux、Python 3.12和对应CUDA/CANN环境。", "递归克隆仓库并运行官方build.sh。", "先跑offline_inference.py，再运行回归测试。", "用benchmark.py记录吞吐、TTFT和显存。", "修改一个变量并做对照实验，不要一次改很多参数。"]
  }
};
document.querySelectorAll(".path-choice").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".path-choice").forEach(b => b.classList.toggle("active", b === button));
    const data = pathData[button.dataset.path];
    document.getElementById("pathPanel").innerHTML = `<div class="path-number">${data.letter}</div><div><h3>${data.title}</h3><ol>${data.steps.map(step => `<li>${step}</li>`).join("")}</ol></div>`;
  });
});

const savedLabs = new Set(JSON.parse(localStorage.getItem(labKey) || "[]"));
document.querySelectorAll("[data-lab]").forEach(box => {
  box.checked = savedLabs.has(box.dataset.lab);
  box.addEventListener("change", () => {
    if (box.checked) savedLabs.add(box.dataset.lab); else savedLabs.delete(box.dataset.lab);
    localStorage.setItem(labKey, JSON.stringify([...savedLabs]));
  });
});

document.querySelectorAll(".copy-code").forEach(button => button.addEventListener("click", async () => {
  const text = document.getElementById(button.dataset.copy).innerText;
  await copyText(text);
}));
document.getElementById("copyMantra").addEventListener("click", () => copyText("找入口 → 下断点 → 看对象 → 记形状 → 画流程"));
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("已复制到剪贴板");
  } catch {
    showToast("复制失败，请手动选择文本");
  }
}

document.getElementById("quizForm").addEventListener("submit", event => {
  event.preventDefault();
  let score = 0;
  document.querySelectorAll("#quizForm fieldset").forEach(fieldset => {
    const selected = fieldset.querySelector("input:checked");
    const correct = selected && selected.value === fieldset.dataset.answer;
    fieldset.classList.toggle("correct", Boolean(correct));
    fieldset.classList.toggle("wrong", !correct);
    fieldset.querySelector(".feedback").textContent = correct ? "回答正确。" : `还差一点，正确答案是：${fieldset.querySelector(`input[value="${fieldset.dataset.answer}"]`).parentElement.textContent.trim()}`;
    if (correct) score++;
  });
  document.getElementById("quizResult").textContent = score === 3 ? "3 / 3 · 很棒，你已经建立了正确的基础概念！" : `${score} / 3 · 回看提示，再试一次就好。`;
});

document.getElementById("resetProgress").addEventListener("click", () => {
  if (!confirm("确定清空全部课程进度和实验勾选吗？")) return;
  completed = new Set();
  localStorage.removeItem(storageKey);
  localStorage.removeItem(labKey);
  document.querySelectorAll("[data-lab]").forEach(box => { box.checked = false; });
  renderProgress();
  showToast("学习进度已重置");
});

let toastTimer;
function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
}

renderTokens();
renderProgress();
