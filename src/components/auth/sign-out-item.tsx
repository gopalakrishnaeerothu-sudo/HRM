"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

/**
 * Sign-out menu item.
 *
 * Navigates with `replace` so the authenticated page cannot be reached with
 * the back button, and calls `router.refresh()` to drop any cached server
 * payload for the old session.
 */
export function SignOutItem() {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  const signOut = async (event: Event) => {
    // Keep the menu open while the request is in flight.
    event.preventDefault();
    if (pending) return;

    setPending(true);
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });

      if (!response.ok) {
        toast.error("Couldn't sign you out. Try again.");
        return;
      }

      router.replace("/login");
      router.refresh();
    } catch {
      toast.error("Couldn't reach the server.");
    } finally {
      setPending(false);
    }
  };

  return (
    <DropdownMenuItem onSelect={signOut} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <LogOut aria-hidden />}
      Sign out
    </DropdownMenuItem>
  );
}
