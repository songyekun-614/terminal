const $ = id => document.getElementById(id);
export function installRecoveryPrompt({ restore, startFresh, focusTerminal }) {
  const dialog = $("recovery"), restoreButton = $("recovery-restore"), newButton = $("recovery-new");
  let busy = false, finish;
  async function choose(recover) {
    if (busy) return;
    busy = true;
    restoreButton.disabled = newButton.disabled = true;
    dialog.setAttribute("aria-busy", "true");
    $("recovery-error").textContent = "";
    restoreButton.textContent = recover ? "正在恢复…" : "恢复会话";
    try {
      if (recover) await restore(); else await startFresh();
      dialog.close("done");
      focusTerminal(); finish();
    } catch (err) {
      $("recovery-error").textContent = `${err.message}。可以重试，或选择新建终端。`;
      if (!dialog.open) dialog.showModal();
    } finally {
      busy = false;
      restoreButton.disabled = newButton.disabled = false;
      restoreButton.textContent = "恢复会话";
      dialog.setAttribute("aria-busy", "false");
    }
  }
  restoreButton.onclick = () => choose(true);
  newButton.onclick = () => choose(false);
  dialog.addEventListener("cancel", event => event.preventDefault());
  return {
    isBusy: () => busy,
    open: summary => new Promise(resolve => {
      finish = resolve;
      $("recovery-summary").textContent = `${summary.tabs} 个标签页 · ${summary.panes} 个面板`;
      $("recovery-time").textContent = `上次保存：${new Date(summary.updatedAt).toLocaleString()}`;
      dialog.showModal(); restoreButton.focus();
    }),
  };
}
