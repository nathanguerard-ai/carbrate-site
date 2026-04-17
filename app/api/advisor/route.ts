import { NextRequest, NextResponse } from "next/server";
import {
  buildEffortAdvisorResult,
  parseAdvisorQuestion,
  type EffortAdvisorInput,
} from "@/lib/advisor";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      question?: string;
      input?: Partial<EffortAdvisorInput>;
    };
    const parsedInput = body.question
      ? parseAdvisorQuestion(body.question)
      : null;
    const input = {
      ...parsedInput,
      ...body.input,
      question: body.question ?? body.input?.question,
    } as EffortAdvisorInput;

    if (!Number.isFinite(input.durationMinutes) || !Number.isFinite(input.targetCarbsPerHour)) {
      return NextResponse.json(
        {
          error:
            "Indique au moins une durée et une cible de glucides par heure.",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(buildEffortAdvisorResult(input));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
