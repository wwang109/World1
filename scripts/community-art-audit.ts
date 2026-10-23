import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { artAsset, artManifest } from '../src/data/artManifest';
import { CARD_ART_CATALOG, cardArtUrl } from '../src/game/ui/cardArtCatalog';
import { EQUIPMENT_ART_ASSETS } from '../src/game/ui/equipmentArt';
import { GEM_ART_ASSETS, gemArtKey } from '../src/game/ui/gemArt';
import { eventArtKey, RUN_ART_KEYS } from '../src/game/ui/runArtKeys';
import { GAME_ROOT, ART_MANIFEST_PATH, validateContentSnapshot } from './contentSnapshot';
import { mutateJson, snapshotFixture } from './content-audit-fixture';
const baselinePath=join(GAME_ROOT,'tmp/community/art-baseline.json');
if(existsSync(baselinePath)){
  const baseline=JSON.parse(readFileSync(baselinePath,'utf8'));
  assert.deepEqual(CARD_ART_CATALOG,baseline.cards);assert.deepEqual(EQUIPMENT_ART_ASSETS,baseline.equipment);assert.deepEqual(GEM_ART_ASSETS,baseline.gems);assert.deepEqual(RUN_ART_KEYS,baseline.keys);
}
for(const entry of Object.values(CARD_ART_CATALOG))assert.ok(existsSync(join(GAME_ROOT,'public',cardArtUrl(entry))));
for(const rarity of ['common','rare','epic','legendary'] as const)assert.equal(gemArtKey(rarity),`gem-rarity-${rarity}`);
for(const id of Object.keys(artManifest.platforms)){assert.ok(artAsset(id,'desktop'));assert.ok(artAsset(id,'mobile'));}
assert.equal(eventArtKey('omen','bell_unbound'),'run-art-event-story-bell-unbound');
const fixture=snapshotFixture();
try{mutateJson(fixture.root,ART_MANIFEST_PATH,a=>{a.events.community_new_event=a.events.bell_unbound;});const result=await validateContentSnapshot(fixture.root);assert.equal(result.art.events.community_new_event,'run-art-event-story-bell-unbound');}
finally{fixture.dispose();}
console.log(`community art OK: ${Object.keys(CARD_ART_CATALOG).length} card mappings, ${EQUIPMENT_ART_ASSETS.length} item aliases, 4 rarities, ${Object.keys(artManifest.platforms).length} paired backgrounds; new event mapping without TS registration`);
