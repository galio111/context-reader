import { NextResponse } from "next/server";
import { getAccountPlan, getAccountSessionState, getUsageBalances, recordDailyActivity } from "@/lib/accountStore";
import {
  getLocalDeveloperAccountState,
  isCloudBackedLocalDeveloperUser,
  isLocalOnlyDeveloperUser,
} from "@/lib/localDeveloper";
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
    if (isLocalOnlyDeveloperUser(user)) {
      return NextResponse.json({ account: getLocalDeveloperAccountState() });
    }
    if (!user) {
      const identity = await resolveUsageIdentity(request);
      const plan = await getAccountPlan("guest");
      await recordDailyActivity(identity).catch(() => undefined);
      return NextResponse.json({
        account: {
          ...anonymousState,
          plan,
          usage: await getUsageBalances(identity.ownerKey, plan),
        },
      });
    }
    const account = await getAccountSessionState(user);
    await recordDailyActivity({ ownerKey: `user:${user.id}`, userId: user.id }).catch(() => undefined);
    return NextResponse.json({
      account: isCloudBackedLocalDeveloperUser(user)
        ? { ...account, localDirect: true }
        : account,
    });
  } catch {
    return NextResponse.json(
      { account: anonymousState, unavailable: true },
      { status: 503 },
    );
  }
}
