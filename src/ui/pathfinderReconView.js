/** Own-force recon readout; maximum sight is still blocked by terrain. */
export function pathfinderReconView(game) {
  if(game?.selection?.length!==1)return null;
  const unit=game.units?.find(unit=>unit.id===game.selection[0]);
  if(!unit||unit.owner!=='player'||unit.defId!=='scout'||unit.hp<=0||unit.embarkedIn)return null;
  const def=game.unitDefs?.scout;
  if(!def)return null;
  const clearSight=game._unitSight?.(unit,def.sight)??def.sight;
  const sight=game._stormSight?.(unit.x,unit.y,clearSight)??clearSight;
  const reach=game._unitWeaponRange?.(unit,def.weapon)??def.weapon?.range;
  if(!Number.isFinite(sight)||!Number.isFinite(reach)||sight<=0)return null;
  return {unit,sight,reach,stormReduced:sight<clearSight-.001};
}
