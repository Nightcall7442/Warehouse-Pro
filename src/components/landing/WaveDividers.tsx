const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

export function WaveTop({ fill = "#fff", className = "" }: { fill?: string; className?: string }) {
  return (
    <div className={cn("absolute top-0 left-0 right-0 -translate-y-[99%]", className)}>
      <svg viewBox="0 0 1440 80" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full" preserveAspectRatio="none">
        <path d="M0,60 C360,10 720,80 1080,30 C1260,10 1380,40 1440,20 L1440,80 L0,80Z" fill={fill} />
      </svg>
    </div>
  );
}

export function WaveBottom({ fill = "#fff", className = "" }: { fill?: string; className?: string }) {
  return (
    <div className={cn("absolute bottom-0 left-0 right-0 translate-y-[99%]", className)}>
      <svg viewBox="0 0 1440 80" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full" preserveAspectRatio="none">
        <path d="M0,20 C360,70 720,0 1080,50 C1260,70 1380,40 1440,60 L1440,0 L0,0Z" fill={fill} />
      </svg>
    </div>
  );
}
