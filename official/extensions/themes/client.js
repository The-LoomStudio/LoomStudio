export function activate(ctx) {
  // Registration alone does not apply effects. The host calls this factory on adoption.
  ctx.styles.register('smooth-motion', style => {
    const registration = style.animations.register('workbench.panel', ({ element, phase, signal }) => {
      signal.throwIfAborted();
      const frames = phase === 'enter'
        ? [
            { opacity: 0, transform: 'perspective(1200px) translateY(24px) rotateX(-5deg) scale(0.96)', transformOrigin: '50% 85%' },
            { opacity: 1, transform: 'perspective(1200px) translateY(0) rotateX(0deg) scale(1)', transformOrigin: '50% 85%' },
          ]
        : [
            { opacity: 1, transform: 'perspective(1200px) translateY(0) rotateX(0deg) scale(1)', transformOrigin: '50% 85%' },
            { opacity: 0, transform: 'perspective(1200px) translateY(12px) rotateX(3deg) scale(0.98)', transformOrigin: '50% 85%' },
          ];
      const animation = element.animate(frames, {
        duration: phase === 'enter' ? 480 : 220,
        easing: phase === 'enter' ? 'cubic-bezier(0.16, 1, 0.3, 1)' : 'ease-in',
        fill: 'both',
      });
      const cancel = () => animation.cancel();
      signal.addEventListener('abort', cancel, { once: true });
      // Handle both completion and cancellation without leaving a rejected cleanup promise.
      const cleanup = () => signal.removeEventListener('abort', cancel);
      void animation.finished.then(cleanup, cleanup);
      return animation;
    });
    return { dispose: () => registration.dispose() };
  });
}
