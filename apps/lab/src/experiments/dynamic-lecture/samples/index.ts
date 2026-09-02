import { kpDerivativeSecant } from './kp-derivative-secant';
import { kpLinearKb } from './kp-linear-kb';
import { meetOnRoad } from './meet-on-road';
import { springLinear } from './spring-linear';
import { taxiFare } from './taxi-fare';
import type { LectureScriptInput } from '../script-schema';

export const DEMO_LESSONS: LectureScriptInput[] = [
  kpLinearKb,
  kpDerivativeSecant,
  springLinear,
  taxiFare,
  meetOnRoad,
];
