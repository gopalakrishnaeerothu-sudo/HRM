import { MarketingFooter, MarketingHeader } from "@/components/landing/marketing-chrome";

/** Public shell: fixed glass header, page content, footer. */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-dvh overflow-x-clip">
      <MarketingHeader />
      <main id="main-content">{children}</main>
      <MarketingFooter />
    </div>
  );
}
