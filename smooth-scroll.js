const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!reduceMotion) {
    let currentY = window.scrollY;
    let targetY = window.scrollY;
    let momentum = 0;
    let frameId = null;
    const MAX_WHEEL_DELTA = 140;
    const MAX_MOMENTUM = 2;
    const MAX_TARGET_LEAD = 720;
    const MAX_FRAME_STEP = 22;

    const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

    const clampScroll = value => {
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        return Math.max(0, Math.min(value, maxScroll));
    };

    const clampTargetLead = () => {
        targetY = clampScroll(clamp(targetY, currentY - MAX_TARGET_LEAD, currentY + MAX_TARGET_LEAD));
    };

    const render = () => {
        if (Math.abs(momentum) > 0.025) {
            targetY = clampScroll(targetY + momentum);
            momentum *= 0.975;
            clampTargetLead();
        } else {
            momentum = 0;
        }

        const easedStep = (targetY - currentY) * 0.038;
        currentY += clamp(easedStep, -MAX_FRAME_STEP, MAX_FRAME_STEP);

        if (Math.abs(targetY - currentY) < 0.4 && momentum === 0) {
            currentY = targetY;
            frameId = null;
        } else {
            frameId = requestAnimationFrame(render);
        }

        window.scrollTo(0, currentY);
    };

    const start = () => {
        if (frameId === null) {
            frameId = requestAnimationFrame(render);
        }
    };

    window.addEventListener('wheel', event => {
        if (event.ctrlKey) {
            return;
        }

        event.preventDefault();
        const wheelDelta = clamp(event.deltaY, -MAX_WHEEL_DELTA, MAX_WHEEL_DELTA);
        targetY = clampScroll(targetY + wheelDelta * 0.45);
        clampTargetLead();
        momentum += wheelDelta * 0.025;
        momentum = clamp(momentum, -MAX_MOMENTUM, MAX_MOMENTUM);
        start();
    }, { passive: false });

    window.addEventListener('resize', () => {
        targetY = clampScroll(targetY);
        currentY = clampScroll(currentY);
    });

    window.addEventListener('scroll', () => {
        if (frameId === null) {
            currentY = window.scrollY;
            targetY = window.scrollY;
            momentum = 0;
        }
    }, { passive: true });
}
