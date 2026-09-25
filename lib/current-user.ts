import { unstable_rethrow } from "next/navigation";
import { verifyAuthToken, getAuthCookie } from "./auth";
import { prisma } from "./prisma";

type AuthPayload = {
  userId: string;
};

export async function getCurrentUser() {
  try {
    const token = await getAuthCookie();
    if (!token) return null;

    const payload = (await verifyAuthToken(token)) as AuthPayload;

    if (!payload?.userId) return null;

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
      },
    });

    return user;
  } catch (error) {
    // Re-throw framework errors (e.g. cookies() during prerender) so Next.js
    // can mark the route as dynamic instead of swallowing them here.
    unstable_rethrow(error);
    console.log("Error getting the current user", error);
    return null;
  }
}
