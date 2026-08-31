import { kpDerivativeSecant } from './kp-derivative-secant';
import { kpLinearKb } from './kp-linear-kb';
import { springLinear } from './spring-linear';
import type { LectureScriptInput } from '../script-schema';

export const DEMO_LESSONS: LectureScriptInput[] = [kpLinearKb, kpDerivativeSecant, springLinear];
