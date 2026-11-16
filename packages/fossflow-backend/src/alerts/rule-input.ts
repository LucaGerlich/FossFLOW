import { z } from 'zod';
import { alertTargetSchema } from './targets.js';

export const MAX_RULES_PER_PROJECT = 100;

const name = z.string().trim().min(1, 'Name is required').max(100, 'Name is too long');
const kind = z.enum(['failing', 'slow', 'silent']);
const threshold = z.number().nullable();
const windowMinutes = z.number().int('Window must be a whole number of minutes');
const minCalls = z.number().int('Minimum calls must be a whole number').min(1, 'Minimum calls is at least 1').max(100000, 'Minimum calls is at most 100000');
const channelIds = z.array(z.string().min(1)).max(10, 'At most 10 channels');
const enabled = z.boolean();

const THRESHOLD_RANGE = { failing: [0.1, 100], slow: [1, 600000] } as const;
const WINDOW_RANGE = { failing: [1, 60], slow: [1, 60], silent: [5, 2880] } as const;

/** The checks that depend on the rule kind; the issue paths name the field. */
function checkByKind(
  rule: { kind: keyof typeof WINDOW_RANGE; threshold?: number | null; windowMinutes?: number },
  ctx: z.RefinementCtx
): void {
  if (rule.kind === 'silent') {
    if (rule.threshold !== undefined && rule.threshold !== null) {
      ctx.addIssue({ code: 'custom', path: ['threshold'], message: 'Threshold is not used by silent rules' });
    }
  } else if (rule.threshold === undefined || rule.threshold === null) {
    ctx.addIssue({ code: 'custom', path: ['threshold'], message: `Threshold is required for ${rule.kind} rules` });
  } else {
    const [low, high] = THRESHOLD_RANGE[rule.kind];
    if (rule.threshold < low || rule.threshold > high) {
      ctx.addIssue({ code: 'custom', path: ['threshold'], message: `Threshold must be between ${low} and ${high}` });
    }
  }
  if (rule.windowMinutes !== undefined) {
    const [low, high] = WINDOW_RANGE[rule.kind];
    if (rule.windowMinutes < low || rule.windowMinutes > high) {
      ctx.addIssue({
        code: 'custom',
        path: ['windowMinutes'],
        message: `Window must be between ${low} and ${high} minutes`
      });
    }
  }
}

export const ruleInputSchema = z
  .object({
    name,
    kind,
    target: alertTargetSchema,
    threshold: threshold.optional(),
    windowMinutes,
    minCalls: minCalls.default(10),
    channelIds: channelIds.default([]),
    enabled: enabled.default(true)
  })
  .superRefine(checkByKind);

/** A PATCH body: any subset; the service validates the merged rule with `ruleInputSchema`. */
export const rulePatchSchema = z.object({
  name: name.optional(),
  kind: kind.optional(),
  target: alertTargetSchema.optional(),
  threshold: threshold.optional(),
  windowMinutes: windowMinutes.optional(),
  minCalls: minCalls.optional(),
  channelIds: channelIds.optional(),
  enabled: enabled.optional()
});

export type RuleInput = z.infer<typeof ruleInputSchema>;
export type RulePatch = z.infer<typeof rulePatchSchema>;
