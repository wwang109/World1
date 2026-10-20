export * from '../../run/skillPresentation';
import {summarizeEffectSegments as summarize,type ScalingStats,type SkillFaceMode} from '../../run/skillPresentation';
import type {SkillDef} from '../../engine/types';
import {cardTypeBadge} from './cardArtPresentation';
export function summarizeEffectSegments(skill:SkillDef,stats?:ScalingStats,mode:SkillFaceMode='summed',affinityOpen?:boolean){return summarize(skill,stats,mode,affinityOpen,cardTypeBadge(skill).color);}
