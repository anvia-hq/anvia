export function AnviaLensLogo({ markClassName }: { markClassName?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <svg
        aria-hidden="true"
        className={`size-6 shrink-0 ${markClassName ?? "text-[#2BF563]"}`}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M12 2.5c.58 5.17 4.33 8.92 9.5 9.5-5.17.58-8.92 4.33-9.5 9.5-.58-5.17-4.33-8.92-9.5-9.5 5.17-.58 8.92-4.33 9.5-9.5Z"
          fill="currentColor"
        />
      </svg>
    </span>
  );
}
