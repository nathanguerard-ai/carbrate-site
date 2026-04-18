import { NextRequest, NextResponse } from "next/server";
import {
  analyzeAdvisorQuestion,
  buildEffortAdvisorResult,
  type EffortAdvisorInput,
} from "@/lib/nutrition-advisor";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      question?: string;
      input?: Partial<EffortAdvisorInput>;
    };
    const analysis = body.question
      ? analyzeAdvisorQuestion(body.question, body.input)
      : null;

    if (analysis?.missingInfo.length) {
      return NextResponse.json(
        {
          error: analysis.prompt,
          missingInfo: analysis.missingInfo,
          input: analysis.input,
        },
        { status: 400 },
      );
    }

    const input = {
      ...analysis?.input,
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
