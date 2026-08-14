"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/** Marks every unread notification for the signed-in user as read. */
export function MarkAllReadButton() {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  const markAll = async () => {
    setPending(true);
    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await response.json();

      if (!response.ok) {
        toast.error(body?.error?.message ?? "Couldn't update your notifications");
        return;
      }

      toast.success(`Marked ${body.data.updated} as read`);
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <Button variant="secondary" size="sm" onClick={markAll} loading={pending}>
      <CheckCheck aria-hidden />
      Mark all read
    </Button>
  );
}
