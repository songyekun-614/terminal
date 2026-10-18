// Layout owns DOM placement only; app.js owns PTYs and their lifetime.
function updateControls(branch) {
  if (!branch.classList.contains("split-layout")) return;
  const [first, separator, second] = branch.children;
  separator.setAttribute("aria-controls", `${first.id} ${second.id}`);
}
export function splitLayout(pane, next, direction, resize) {
  const branch = document.createElement("div");
  branch.className = `split-layout ${direction}`;
  branch.id = `split-${crypto.randomUUID()}`;
  const separator = document.createElement("div");
  separator.className = "split-separator";
  separator.tabIndex = 0;
  separator.setAttribute("role", "separator");
  separator.setAttribute("aria-label", direction === "horizontal" ? "调整左右分屏比例" : "调整上下分屏比例");
  separator.setAttribute("aria-orientation", direction === "horizontal" ? "vertical" : "horizontal");
  separator.setAttribute("aria-valuemin", "15");
  separator.setAttribute("aria-valuemax", "85");
  let ratio = 50;
  function setRatio(value) {
    ratio = Math.max(15, Math.min(85, Math.round(value)));
    branch.style.setProperty("--split-ratio", `${ratio}%`);
    separator.setAttribute("aria-valuenow", String(ratio));
    resize();
  }
  let pointer = null;
  let grabOffset = 0;
  separator.onpointerdown = event => {
    if (event.button !== 0) return;
    event.preventDefault();
    const box = separator.getBoundingClientRect();
    grabOffset = direction === "horizontal"
      ? event.clientX - (box.x + box.width / 2)
      : event.clientY - (box.y + box.height / 2);
    pointer = event.pointerId;
    separator.setPointerCapture(pointer);
    separator.focus();
  };
  separator.onpointermove = event => {
    if (event.pointerId !== pointer) return;
    const box = branch.getBoundingClientRect();
    const horizontal = direction === "horizontal";
    const length = horizontal ? box.width : box.height;
    const offset = (horizontal ? event.clientX - box.x : event.clientY - box.y) - grabOffset;
    if (length > 0) setRatio(offset / length * 100);
  };
  separator.onpointerup = separator.onpointercancel = () => { pointer = null; };
  separator.onlostpointercapture = () => { pointer = null; };
  separator.onkeydown = event => {
    const previous = direction === "horizontal" ? "ArrowLeft" : "ArrowUp";
    const nextKey = direction === "horizontal" ? "ArrowRight" : "ArrowDown";
    if (![previous, nextKey, "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    setRatio(event.key === "Home" ? 15 : event.key === "End" ? 85 : ratio + (event.key === previous ? -5 : 5));
  };
  pane.replaceWith(branch);
  branch.append(pane, separator, next);
  updateControls(branch);
  updateControls(branch.parentElement);
  setRatio(50);
  return { branch, setRatio };
}

export function removePaneLayout(pane) {
  const branch = pane.parentElement;
  if (branch.classList.contains("split-layout")) {
    const sibling = [...branch.children].find(child => child !== pane && !child.classList.contains("split-separator"));
    const parent = branch.parentElement;
    branch.replaceWith(sibling);
    updateControls(parent);
  } else pane.remove();
}
