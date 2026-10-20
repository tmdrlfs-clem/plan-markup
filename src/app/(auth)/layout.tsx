// Shell for the sign-in and PendingActivation screens: Blueprint theme (dark
// with the orange accent, same as the workspace), centred single column. No
// auth logic here: each page checks for itself.
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div data-theme="blueprint" className="flex flex-1 flex-col bg-surface-0 text-text">
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        {children}
      </main>
    </div>
  );
}
