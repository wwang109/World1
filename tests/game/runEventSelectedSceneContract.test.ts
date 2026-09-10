import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCENE_ROOT = join(process.cwd(), 'src', 'game', 'scenes');
const readScene = (name: string): string => readFileSync(join(SCENE_ROOT, name), 'utf8');

describe('selected-event choosing screen contract', () => {
  it('desktop composes one story-left / outcomes-right region with an explicit choice count', () => {
    const source = readScene('DesktopRunEventScene.ts');

    expect(source).toContain('desktopEventChoosingLayout(');
    expect(source).toContain('renderRunEventOutcomePane(this, paneTemplate)');
    expect(source).toContain('`CHOOSE 1 OF ${event.choices.length}`');
    expect(source).toContain('renderStory(presentation, layout.story)');
    expect(source).toMatch(/renderChoicePanel\(event,[\s\S]*layout\.outcomes/);
  });

  it('compact mode keeps story then outcomes in one vertical hierarchy', () => {
    const source = readScene('MobileRunEventScene.ts');

    expect(source).toContain('mobileEventChoosingLayout(');
    expect(source).toContain('renderRunEventOutcomePane(this, paneTemplate)');
    expect(source).toContain('`CHOOSE 1 OF ${event.choices.length}`');
    expect(source).toContain('renderStory(presentation, layout.story)');
    expect(source).toMatch(/renderChoices\(event,[\s\S]*layout\.outcomes/);
  });

  it.each(['DesktopRunEventScene.ts', 'MobileRunEventScene.ts'])(
    '%s does not fade the choice controls during their interactive entrance',
    (name) => {
      const source = readScene(name);
      expect(source).not.toMatch(/appearIndex:\s*choiceIndex/);
    },
  );
});
