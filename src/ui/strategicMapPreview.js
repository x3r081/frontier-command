/** A deliberately schematic map briefing built from the same tiles as a battle. */
export function drawStrategicMapPreview(canvas, game) {
  const context = canvas.getContext('2d');
  if (!context) return;
  const scaleX = canvas.width / game.width;
  const scaleY = canvas.height / game.height;
  const palette = {
    sand: ['#2b3b33', '#304238', '#35483b', '#3a4d40'],
    rock: ['#63716a', '#6b7971', '#748177', '#79877d'],
    water: ['#153b45', '#1a4650', '#1e515b', '#225861'],
    bridge: ['#85816b', '#97917a', '#a6a087', '#b2aa8f'],
    crystal: ['#4d7b57', '#558960', '#60996b', '#6da678'],
  };
  context.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < game.height; y++) for (let x = 0; x < game.width; x++) {
    const tile = game.terrain[y][x];
    context.fillStyle = (palette[tile.type] || palette.sand)[tile.shade || 0];
    context.fillRect(x * scaleX, y * scaleY, Math.ceil(scaleX), Math.ceil(scaleY));
    if (tile.type === 'crystal' && tile.resource > 0) {
      context.fillStyle = tile.detail > 0.5 ? '#aaf5a0' : '#8de3af';
      context.fillRect((x + .35) * scaleX, (y + .25) * scaleY, Math.max(1, scaleX * .34), Math.max(1, scaleY * .48));
    }
  }
  context.lineWidth = 1;
  context.strokeStyle = 'rgba(218, 238, 199, .07)';
  for (let x = 8; x < game.width; x += 8) {
    context.beginPath(); context.moveTo(x * scaleX + .5, 0);
    context.lineTo(x * scaleX + .5, canvas.height); context.stroke();
  }
  for (let y = 8; y < game.height; y += 8) {
    context.beginPath(); context.moveTo(0, y * scaleY + .5);
    context.lineTo(canvas.width, y * scaleY + .5); context.stroke();
  }
  for (const bridge of game.bridges) {
    context.strokeStyle = '#e8d9a5'; context.lineWidth = 2;
    context.strokeRect((bridge.x + .15) * scaleX, (bridge.y + .15) * scaleY,
      (bridge.w - .3) * scaleX, (bridge.h - .3) * scaleY);
  }
  for (const relay of game.relays) {
    const px = relay.x * scaleX, py = relay.y * scaleY;
    context.beginPath(); context.arc(px, py, 5, 0, Math.PI * 2);
    context.fillStyle = '#e9f4ad'; context.fill();
    context.strokeStyle = '#18251e'; context.lineWidth = 2; context.stroke();
    context.beginPath(); context.arc(px, py, 9, 0, Math.PI * 2);
    context.strokeStyle = 'rgba(228, 244, 165, .74)'; context.lineWidth = 1.5; context.stroke();
  }
  for (const [owner, color] of [['player', '#bff576'], ['enemy', '#ff8171']]) {
    const command = game.buildings.find(building => building.owner === owner && building.defId === 'command');
    const rig = game.units.find(unit => unit.owner === owner && unit.defId === 'mcv');
    const px = (command ? command.x + command.w / 2 : rig?.x) * scaleX;
    const py = (command ? command.y + command.h / 2 : rig?.y) * scaleY;
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    context.fillStyle = color;
    context.strokeStyle = '#14241d'; context.lineWidth = 2;
    context.beginPath(); context.moveTo(px, py - 8); context.lineTo(px + 8, py);
    context.lineTo(px, py + 8); context.lineTo(px - 8, py); context.closePath();
    context.fill(); context.stroke();
  }
  context.strokeStyle = 'rgba(211, 236, 194, .43)'; context.lineWidth = 2;
  context.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
}
