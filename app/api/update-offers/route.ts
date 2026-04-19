import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";

export async function POST(request: NextRequest) {
  try {
    const force = request.nextUrl.searchParams.get("force") === "1";
    const command = force
      ? "node scripts/refresh-product-offers.mjs --live --force"
      : "node scripts/refresh-product-offers.mjs --live";

    const output = execSync(command, {
      env: { ...process.env, CARBRATE_ENABLE_NETWORK: "1" },
      cwd: process.cwd(),
      stdio: "pipe",
    });

    return NextResponse.json({
      success: true,
      message: "Prices updated successfully",
      output: output.toString(),
    });
  } catch (error) {
    console.error("Error updating offers:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
