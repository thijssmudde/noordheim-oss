'use client';
import { useEffect } from 'react';

const SCRIPT_ID = 'buildhop-feedback-widget-script';
const HOST = '[data-buildhop-feedback-widget]';
// Menus are short-lived, so wait less than a content site would, but still
// stay out of the first paint and the backdrop's scene build.
const LOAD_DELAY_MS = 3000;

function removeHosts() {
  document.querySelectorAll(HOST).forEach((host) => host.remove());
}

/**
 * BuildHop's feedback launcher for every screen outside a live match. It
 * mounts with the menus and unmounts when the HUD takes over, taking the
 * launcher with it so it never sits on top of the battlefield.
 */
export function BuildHopWidget() {
  // Injecting a third-party script is a sync with the outside world, which is
  // what effects are for.
  useEffect(() => {
    // buildhop.io and freescan.app preview the site in an iframe.
    if (window.self !== window.top) return;
    let mounted = true;
    let script: HTMLScriptElement | null = null;
    const timer = window.setTimeout(() => {
      if (document.getElementById(SCRIPT_ID)) return;
      script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = 'https://buildhop.io/feedback-widget.js';
      script.async = true;
      script.dataset.launchId = 'd383576c-b911-4c14-9753-a42bd7302761';
      // A script that finishes loading after the menus closed still builds
      // its launcher; take it straight back down.
      script.addEventListener('load', () => {
        if (!mounted) removeHosts();
      });
      document.body.appendChild(script);
    }, LOAD_DELAY_MS);
    return () => {
      mounted = false;
      window.clearTimeout(timer);
      script?.remove();
      removeHosts();
      // The script may create its host in the same task it loads in.
      window.setTimeout(removeHosts, 0);
    };
  }, []);
  return null;
}
