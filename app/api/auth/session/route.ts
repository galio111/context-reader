import { NextResponse } from "next/server";
import { getAccountPlan, getAccountSessionState, getUsageBalances } from "@/lib/accountStore";
import { getAuthenticatedUser, isAccountSystemConfigured } from "@/lib/userAuth";
import { resolveUsageIdentity } from "@/lib/usageIdentity";
import type { AccountSessionState } from "@/types/account";

const anonymousState: AccountSessionState = {
  configured: true,
  authenticated: false,
  profile: null,
  plan: null,
  usage: [],
};

export async function GET(request: Request) {
  if (!isAccountSystemConfigured()) {
    return NextResponse.json({ account: { ...anonymousState, configured: false } });
  }

  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      const identity = await resolveUsageIdentity(request);
      const plan = await getAccountPlan("guest");
      return NextResponse.json({
        account: {
          ...anonymousState,
          plan,
          usage: await getUsageBalances(identity.ownerKey, plan),
        },
      });
    }
    return NextResponse.json({ account: await getAccountSessionState(user) });
  } catch {
    return NextResponse.json(
      { account: anonymousState, unavailable: true },
      { status: 503 },
    );
  }
}
