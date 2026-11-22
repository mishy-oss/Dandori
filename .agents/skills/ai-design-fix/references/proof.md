# Proof on screen: what makes a page stick

A page can pass every rule and still be forgotten by evening. We redesigned one real company site four times to find out
why. A version driven only by measurements looked worse than the original. A tasteful one with good photos got "nice,
but it doesn't grab me". The one people wanted to show someone else had the product working in the middle of it. Read
this before you touch a landing page or any screen that has to impress.

## Claim, then proof

Write down what the page claims, in its own words. Then decide what on the screen makes that claim visibly true.

| The page claims | Weak proof | Strong proof |
| --- | --- | --- |
| Every process on one platform | Six cards, one per product | One order number travels on screen from the shop to the invoice to the parcel |
| Invoices in seconds | A stopwatch icon | An invoice fills in, gets sent and changes state while you watch |
| Used by hundreds of shops | A big number in a tile | Named shops and their logos, right under the first screen |

If your proof would stay true with a rival's logo on top, keep looking. "Modern" and "premium" are not claims, so they
cannot be proved.

## Let the proof choose the first screen

- **Software you can watch working:** the working window is the first screen. Large, real proportions, doing something.
- **A business in the physical world** (a shop, a clinic, a workshop): one real place, with the product's events pinned to
  an object in it by thin lines. "Order received" on the parcel turns a pleasant photo into an argument.
- **A value that is a number:** the number, very large, with what it is compared to. It has to be real.

Any of the three needs one subject, a headline that stays readable, and one main action. A photo under a dark overlay
proves nothing, and neither does a row of stat tiles.

## Make product views believable

- Use real proportions and real navigation labels. Have one item selected and one item changing.
- Every view is full when it arrives. An invoice with one line and a blank panel reads as broken, even if it fills up
  three seconds later.
- Sample rows may be invented, and they have to look invented. "Ege Makine" could be a real company and a price looks like
  a promise, so use names nobody could mistake for a customer. Facts about the business (figures, clients, claims) come only
  from what the page already says.
- Shrink how much is shown, never the text size.

## Images

- Use an image tool only if the user has already connected one, and ask before any paid generation. Without a tool, build
  the product view and hand over the prompt.
- Ask for one subject, a stated light and a stated place for the text. Never ask for text in the image.
- Use the page's colours, export at the shown width in the project's format, and write real alt text.
- Generated people imply staff and customers that do not exist. One or two images carry more than fifteen pleasant ones,
  and the owner's real photos beat all of them.
- Where a section explains what something does, prefer a small live graphic built in SVG, CSS or canvas over a photo: crisp at
  any size, light, and its words stay editable. Each one needs its own idea; one template repeated six times is decoration.

## Keep the brand's face

- A real logo, colour and typeface stay.
- A filled button keeps its text colour. Swapping white for black to pass a contrast number changes how the brand looks,
  and people notice it first. Report the ratio and let the owner decide.
- Warmth counts. If you take people out of a page, replace them with something at least as warm.
- Fixing numbers is not a redesign. The first screen, the next one and at least one below should change in composition, while
  the sections, their order, the words and the links stay.

## Something has to be alive

People remember what moves, as long as the movement is the product at work: a new row arrives, a status changes, a number
ticks. Motion that only loops over text is decoration. A moving surface in brand colours is fine if it stays inside a card
or a panel, and it earns more when it reacts to the visitor. For collections, see [motions.md](motions.md).

## Pace the page

- Do not follow your richest section with a catalogue of the same things. We watched a page go flat when a live product
  stage was followed by photos of the same products.
- No two neighbouring sections share a layout. "Label, big heading left, paragraph right, grid below" six times is a template,
  however good each section looks.
- Make one thing, a figure or a short phrase, far bigger than the rest. Once. Every other heading stays on the scale; one
  page with four giant headings looked absurd to its owner, who was right.
- Put evidence early. Nobody should scroll 12,000 px to meet the first customer.
- Every pinned section costs height. Check the length on a phone, where it adds up fastest.

## Make it yours

A reference shows what is possible; it is not a layout to rebuild. Before anything from a reference ships, name what you
took (a technique, a reason) and check that none of these came along: its wording, its order of moves, its type, its
palette, its showcase object. Someone who has seen the reference should not recognise it. If they would, go back to the
claim and ask what this product's own proof looks like.

## Test the first visit, not your favourite frame

- Open the page in a clean browser profile and watch the first ten seconds. A discount popup and a cookie box can blur the
  whole first screen, and recordings made with them dismissed will never show it.
- Content is there without JavaScript, and nothing on the first screen starts at `opacity: 0`.
- `prefers-reduced-motion` gets a still, complete page. Canvases pause off screen. Phones get a simpler version, not a
  slower one.
- `overflow-x: hidden` or `clip` on a wrapper hides real overflow from your checks. Test without it.

## Before you hand it over

1. Cover the logo. Can you still say whose page it is?
2. What exactly would someone record and send to a friend? Name the second. No answer, no impression.
3. Say in one sentence what is new on the first screen. If you need a list, it is polish.
4. Compare words, links and figures with the original, line by line.
5. Record yourself scrolling and read the frames. A screenshot cannot judge motion.
