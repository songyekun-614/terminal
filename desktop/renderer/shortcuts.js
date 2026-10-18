import shortcutModel from "../src/shortcuts.cjs";
const { commands, defaults, normalizeChord, validateShortcuts, shortcutFromEvent } = shortcutModel;
const $ = id => document.getElementById(id);

export function installShortcutPreferences({ api, getSettings, apply, focusTerminal }) {
  const dialog = $("shortcuts"), form = $("shortcuts-form"), rows = new Map();
  let draft, recording = null, saving = false;
  for (const group of new Set(commands.map(c => c.group))) {
    const section = document.createElement("section");
    section.className = "shortcut-section";
    const heading = document.createElement("h3");
    heading.id = `shortcut-group-${rows.size}`;
    heading.textContent = group;
    section.setAttribute("aria-labelledby", heading.id);
    const list = document.createElement("ul");
    for (const command of commands.filter(c => c.group === group)) {
      const row = document.createElement("li");
      row.className = "shortcut-row";
      const label = document.createElement("span");
      label.className = "shortcut-label";
      label.textContent = command.label;
      const controls = document.createElement("div");
      controls.className = "shortcut-controls";
      const record = document.createElement("button");
      record.type = "button";
      record.className = "shortcut-recorder";
      record.setAttribute("aria-label", `${command.label}快捷键`);
      const description = document.createElement("span");
      description.id = `shortcut-description-${command.id}`;
      description.hidden = true;
      record.setAttribute("aria-describedby", `${description.id} shortcuts-help shortcuts-error`);
      record.onclick = () => {
        recording = recording === command.id ? null : command.id;
        $("shortcuts-recording").textContent = recording ? `正在录入${command.label}：请按下组合键；Esc 取消，Delete 清除。` : "";
        refresh();
      };
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "shortcut-clear";
      clear.textContent = "×";
      clear.setAttribute("aria-label", `清除${command.label}快捷键`);
      clear.onclick = () => { draft[command.id] = ""; stopRecording(); refresh(); record.focus(); };
      controls.append(record, clear);
      row.append(label, controls, description);
      list.append(row);
      rows.set(command.id, { row, record, clear, description });
    }
    section.append(heading, list);
    $("shortcuts-list").append(section);
  }
  function showBinding(button, chord, isRecording) {
    button.replaceChildren();
    if (isRecording || !chord) {
      const text = document.createElement("span");
      text.className = "shortcut-placeholder";
      text.textContent = isRecording ? "按下组合键…" : "未设置";
      button.append(text);
    } else {
      for (const [index, key] of chord.split("+").entries()) {
        if (index) {
          const plus = document.createElement("span");
          plus.className = "shortcut-plus";
          plus.textContent = "+";
          plus.setAttribute("aria-hidden", "true");
          button.append(plus);
        }
        const cap = document.createElement("kbd");
        cap.textContent = key === "Escape" ? "Esc" : key;
        button.append(cap);
      }
    }
  }
  function stopRecording() {
    recording = null;
    $("shortcuts-recording").textContent = "";
  }
  function refresh() {
    for (const [id, { row, record, clear, description }] of rows) {
      const isRecording = recording === id;
      row.classList.toggle("recording", isRecording);
      record.setAttribute("aria-pressed", String(isRecording));
      description.textContent = `当前快捷键：${draft[id] || "未设置"}${isRecording ? "，正在录入" : ""}`;
      record.removeAttribute("aria-invalid");
      row.classList.remove("conflict");
      clear.disabled = !draft[id] || saving;
      record.disabled = saving;
      showBinding(record, draft[id], isRecording);
    }
    $("shortcuts-error").textContent = "";
    let invalid = false;
    try { validateShortcuts(draft); }
    catch (err) {
      invalid = true;
      $("shortcuts-error").textContent = err.message;
      for (const id of err.conflicts || [err.action]) {
        if (!rows.has(id)) continue;
        rows.get(id).record.setAttribute("aria-invalid", "true");
        rows.get(id).row.classList.add("conflict");
      }
    }
    $("shortcuts-save").disabled = invalid || saving || Boolean(recording);
    $("shortcuts-reset").disabled = saving;
    $("shortcuts-cancel").disabled = saving;
  }
  function open() {
    if (dialog.open || saving) return;
    draft = { ...getSettings().shortcuts };
    stopRecording();
    refresh();
    dialog.showModal();
  }
  function handleRecording(event) {
    if (!dialog.open || !recording) return false;
    if (event.key === "Tab" && !event.ctrlKey && !event.altKey && !event.metaKey) {
      stopRecording(); refresh(); return false;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat || event.isComposing || event.keyCode === 229 || event.getModifierState?.("AltGraph")) return true;
    if (event.key === "Escape" && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
      stopRecording(); refresh(); return true;
    }
    const chord = shortcutFromEvent(event);
    if (!chord) return true;
    const id = recording;
    if (["Backspace", "Delete"].includes(chord)) draft[id] = "";
    else {
      try {
        const normalized = normalizeChord(chord);
        if (normalized.endsWith("Escape")) throw Error("Esc 保留用于取消录入；请使用其他组合键");
        draft[id] = normalized;
      } catch (err) {
        $("shortcuts-error").textContent = err.message;
        rows.get(id).record.setAttribute("aria-invalid", "true");
        return true;
      }
    }
    stopRecording(); refresh();
    rows.get(id).record.focus();
    return true;
  }
  $("shortcuts-reset").onclick = () => { draft = { ...defaults }; stopRecording(); refresh(); };
  function restoreFocus() {
    if (document.querySelector("dialog[open]")) $("shortcuts-open").focus();
    else focusTerminal();
  }
  function closeDialog(result) {
    if (saving) return;
    dialog.close(result);
    // HTML dialog's close event is queued for a later rendering step. Restore
    // focus now so a key pressed immediately after Save cannot target the opener.
    restoreFocus();
  }
  $("shortcuts-cancel").onclick = () => closeDialog("cancel");
  dialog.addEventListener("cancel", event => { event.preventDefault(); closeDialog("cancel"); });
  dialog.addEventListener("close", () => { stopRecording(); restoreFocus(); });
  form.onsubmit = async event => {
    event.preventDefault();
    if (saving || recording) return;
    let saveError;
    try {
      const shortcuts = validateShortcuts(draft);
      saving = true; refresh();
      const persisted = await api.saveShortcuts(shortcuts);
      apply(persisted);
      dialog.close("saved");
      restoreFocus();
    } catch (err) { saveError = err.message; }
    finally {
      saving = false; refresh();
      if (saveError) $("shortcuts-error").textContent = saveError;
    }
  };
  // Preserve the appearance settings draft when the shortcut dialog is opened above it.
  $("shortcuts-open").onclick = open;
  return { open, handleRecording, cancel: () => closeDialog("cancel"), isSaving: () => saving };
}
