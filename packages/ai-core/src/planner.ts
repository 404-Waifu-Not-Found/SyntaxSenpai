/**
 * Plan-then-execute: ask the LLM to decompose a goal into ordered steps,
 * then drive the runtime through each step.
 *
 * Inspired by pguso/ai-agents-from-scratch L10 (Atom-of-Thought planner).
 */

import type { AIChatRuntime } from "./runtime";
import type { Message, ToolDefinition } from "./types";
import type { TraceHandler } from "./trace";

export interface PlanStep {
  id: string;
  description: string;
  dependsOn?: string[];
}

export interface Plan {
  goal: string;
  steps: PlanStep[];
}

export interface PlanExecutionStepResult {
  step: PlanStep;
  output: string;
  error?: string;
}

export interface PlanExecutionResult {
  plan: Plan;
  steps: PlanExecutionStepResult[];
  finalAnswer: string;
}

const PLAN_PROMPT = `You are a planning module. Decompose the user's goal into 2-6 concrete, ordered steps.
Return ONLY compact JSON matching: {"steps":[{"id":"s1","description":"...","dependsOn":["s0"]}]}.
Keep descriptions short and actionable. No prose, no markdown fences.`;

export interface CreatePlanOptions {
  goal: string;
  systemPrompt?: string;
  maxSteps?: number;
}

export async function createPlan(
  runtime: AIChatRuntime,
  options: CreatePlanOptions
): Promise<Plan> {
  const { goal, maxSteps = 6 } = options;
  const result = await runtime.sendMessage({
    text: `Goal: ${goal}\nMax steps: ${maxSteps}\nReturn JSON only.`,
    systemPrompt: options.systemPrompt ?? PLAN_PROMPT,
    temperature: 0.2,
  });

  const steps = parsePlanSteps(stringify(result.response.content));
  return { goal, steps: steps.slice(0, maxSteps) };
}

export interface ExecutePlanOptions {
  plan: Plan;
  tools?: ToolDefinition[];
  systemPrompt?: string;
  toolExecutor?: Parameters<AIChatRuntime["sendMessage"]>[1];
  history?: Message[];
  onTrace?: TraceHandler;
  onStepStart?: (step: PlanStep) => void;
  onStepComplete?: (result: PlanExecutionStepResult) => void;
}

export async function executePlan(
  runtime: AIChatRuntime,
  options: ExecutePlanOptions
): Promise<PlanExecutionResult> {
  const history: Message[] = options.history ? [...options.history] : [];
  const stepResults: PlanExecutionStepResult[] = [];

  for (const step of options.plan.steps) {
    options.onStepStart?.(step);

    try {
      const result = await runtime.sendMessage(
        {
          text: `Goal: ${options.plan.goal}\nStep ${step.id}: ${step.description}\nPrior outputs available in conversation. Execute this step and report the outcome.`,
          systemPrompt: options.systemPrompt,
          tools: options.tools,
          history,
          onTrace: options.onTrace,
        },
        options.toolExecutor
      );

      history.push(...result.messages.slice(history.length));
      const output = stringify(result.response.content);
      const stepResult: PlanExecutionStepResult = { step, output };
      stepResults.push(stepResult);
      options.onStepComplete?.(stepResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stepResult: PlanExecutionStepResult = {
        step,
        output: "",
        error: message,
      };
      stepResults.push(stepResult);
      options.onStepComplete?.(stepResult);
      break;
    }
  }

  const finalAnswer = stepResults
    .filter((r) => !r.error)
    .map((r) => `${r.step.id}: ${r.output}`)
    .join("\n\n");

  return { plan: options.plan, steps: stepResults, finalAnswer };
}

function parsePlanSteps(raw: string): PlanStep[] {
  const json = extractJson(raw);
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as { steps?: PlanStep[] };
    if (!Array.isArray(parsed.steps)) return [];
    return parsed.steps
      .filter((s) => s && typeof s.id === "string" && typeof s.description === "string")
      .map((s) => ({ id: s.id, description: s.description, dependsOn: s.dependsOn }));
  } catch {
    return [];
  }
}

function extractJson(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? raw).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

function stringify(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === "object" && "text" in p ? (p as { text?: string }).text ?? "" : ""))
      .join("");
  }
  return "";
}
