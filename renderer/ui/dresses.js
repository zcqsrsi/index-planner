// The project page's dress: how the tasks pane is set. The DOM is one —
// every dress is a class on the pane plus a CSS block in projects.css,
// mixed from theme tokens so all 16 themes wear every dress. The content
// never changes, only the clothes. Mockups: mockup-project-round2.html.

export const DEFAULT_DRESS = 'quiet-console';

export const DRESSES = [
  {
    id: 'quiet-console',
    name: 'Quiet console',
    blurb: 'Serif reading text, dotted rules, numbered aims — the console without the hardware.',
  },
  {
    id: 'console-serif',
    name: 'Console serif',
    blurb: 'Corner brackets frame the Big picture and every aim; mono labels, serif voice.',
  },
  {
    id: 'index',
    name: 'Index',
    blurb: 'The current page tightened — hairline rules, serif, outline chips.',
  },
  {
    id: 'console',
    name: 'Console',
    blurb: 'Clean holographics, all instrumentation — everything in mono, brackets on aims.',
  },
  {
    id: 'ledger',
    name: 'Ledger',
    blurb: 'Ink on paper — hairlines and whitespace do the grouping.',
  },
  {
    id: 'dossier',
    name: 'Dossier',
    blurb: 'The case file — aims as folder tabs, a stamped status, a double rule.',
  },
  {
    id: 'marginalia',
    name: 'Marginalia',
    blurb: 'The page as a book — no bars, no pills, an epigraph for the Big picture.',
  },
];

export const dressId = (settings) =>
  DRESSES.some(d => d.id === settings?.dress) ? settings.dress : DEFAULT_DRESS;