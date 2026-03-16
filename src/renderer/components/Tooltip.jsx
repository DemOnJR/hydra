import * as React from "react";
import { createPortal } from "react-dom";

export function Tooltip({ children, content, position = "right", disabled = false }) {
  const [show, setShow] = React.useState(false);
  const [coords, setCoords] = React.useState({ top: 0, left: 0 });
  const containerRef = React.useRef(null);

  const updateCoords = () => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setCoords({
        top: rect.top + rect.height / 2,
        left: rect.left + rect.width / 2,
        width: rect.width,
        height: rect.height,
        rawRect: rect
      });
    }
  };

  const handleMouseEnter = () => {
    updateCoords();
    setShow(true);
  };

  if (disabled || !content) {
    return <>{children}</>;
  }

  const getPositionStyles = () => {
    if (!coords.rawRect) return {};
    const offset = 12;
    const { rawRect } = coords;

    switch (position) {
      case "right":
        return {
          top: rawRect.top + rawRect.height / 2,
          left: rawRect.right + offset,
          transform: "translateY(-50%)"
        };
      case "left":
        return {
          top: rawRect.top + rawRect.height / 2,
          left: rawRect.left - offset,
          transform: "translate(-100%, -50%)"
        };
      case "top":
        return {
          top: rawRect.top - offset,
          left: rawRect.left + rawRect.width / 2,
          transform: "translate(-50%, -100%)"
        };
      case "bottom":
        return {
          top: rawRect.bottom + offset,
          left: rawRect.left + rawRect.width / 2,
          transform: "translate(-50%, 0)"
        };
      default:
        return {};
    }
  };

  const arrowClasses = {
    right: "-left-1 top-1/2 -translate-y-1/2 border-r-zinc-800 border-t-transparent border-b-transparent",
    left: "-right-1 top-1/2 -translate-y-1/2 border-l-zinc-800 border-t-transparent border-b-transparent",
    top: "-bottom-1 left-1/2 -translate-x-1/2 border-t-zinc-800 border-l-transparent border-r-transparent",
    bottom: "-top-1 left-1/2 -translate-x-1/2 border-b-zinc-800 border-l-transparent border-r-transparent"
  };

  return (
    <div 
      className="relative flex items-center justify-center"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setShow(false)}
      ref={containerRef}
    >
      {children}
      
      {show && createPortal(
        <div 
          className="fixed z-[9999] animate-in fade-in zoom-in-95 duration-200 pointer-events-none"
          style={getPositionStyles()}
        >
          <div className="relative px-3 py-2 bg-zinc-800 border border-white/10 rounded-xl shadow-2xl backdrop-blur-md min-w-max">
            {/* Arrow */}
            <div className={`absolute w-0 h-0 border-4 ${arrowClasses[position]}`} />
            
            <div className="text-[11px] font-bold text-zinc-100 whitespace-pre-wrap leading-tight tracking-tight max-w-[240px]">
              {content}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
