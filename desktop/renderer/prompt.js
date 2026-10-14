// Repaint existing idle prompt cells without sending input to the shell.
export function installPrompt(session) {
  session.idle = false;
  session.term.parser.registerOscHandler(666, (value) => {
    session.idle = value === "vte.ext.macstyle.prompt-idle=1";
    if (session.idle)
      session.promptRow =
        session.term.buffer.active.baseY + session.term.buffer.active.cursorY;
    return true;
  });
  session.term.parser.registerOscHandler(7, (value) => {
    try {
      const url = new URL(value);
      if (url.protocol === "file:")
        session.cwd = decodeURIComponent(url.pathname);
    } catch {}
    return true;
  });
}
export function recolorPrompt(session, color) {
  if (!session.idle || !/^#[0-9a-f]{6}$/i.test(color)) return;
  const term = session.term,
    buffer = term.buffer.active;
  let text = "",
    positions = [];
  const startRow = Math.max(
    buffer.baseY,
    session.promptRow ?? buffer.baseY + buffer.cursorY,
  );
  for (
    let absolute = startRow;
    absolute <= buffer.baseY + buffer.cursorY;
    absolute++
  ) {
    const row = buffer.getLine(absolute);
    if (!row) continue;
    const next = buffer.getLine(absolute + 1),
      limit = next?.isWrapped ? term.cols : row.translateToString(true).length;
    let characterCount = 0;
    for (
      let column = 0;
      column < term.cols && characterCount < limit;
      column++
    ) {
      const cell = row.getCell(column),
        chars = cell?.getChars() || (cell?.getWidth() === 0 ? "" : " ");
      text += chars;
      for (let i = 0; i < chars.length; i++)
        positions.push({ row: absolute - buffer.baseY, column, cell });
      characterCount += chars.length;
    }
  }
  const names = [
    `${session.user}@${session.host}`,
    `${session.user}@${session.host.split(".")[0]}`,
  ];
  const name = names.find((candidate) => text.includes(candidate));
  if (!name) return;
  const start = text.indexOf(name),
    cells = positions.slice(start, start + name.length),
    rgbValue = parseInt(color.slice(1), 16);
  if (
    !cells.every(
      (p) =>
        p?.cell.isFgRGB() && session.promptColors?.has(p.cell.getFgColor()),
    )
  )
    return;
  if (cells.every((p) => p?.cell.isFgRGB() && p.cell.getFgColor() === rgbValue))
    return;
  const rgb = [1, 3, 5]
    .map((i) => parseInt(color.slice(i, i + 2), 16))
    .join(";");
  let output = "\x1b7";
  // Each row is repainted separately to avoid triggering automatic wrap or scroll.
  let offset = 0;
  while (offset < name.length) {
    const position = cells[offset];
    if (!position) return;
    let end = offset + 1;
    while (end < name.length && cells[end]?.row === position.row) end++;
    output += `\x1b[${position.row + 1};${position.column + 1}H\x1b[38;2;${rgb}m${name.slice(offset, end)}\x1b[0m`;
    offset = end;
  }
  term.write(output + "\x1b8");
}
