# Showcase motion: a stage of cards that move as one

How to build one moving stage for a collection: modules, products, templates, case studies. One card leads, the words
for it stay still, and the whole set can rearrange without a jump. Open
[motion-gallery.html](motion-gallery.html) to see it working (add `#tour` to the address for the guide cursor).

That file is one answer, for a product made of modules. **Copy its engine, not its look.** Its drawer, thread, wording
and colours belong to that example; a real page gets arrangements from its own product.

**Use it** on landing pages and product pages, once per page, for five or more items. **Do not use it** in panels,
dashboards, forms, settings or lists people work in: there `no-hover-scale`, `no-bounce-easing` and the plain list stay
in charge. A card that grows here is selected, not hovered, and nobody is trying to click a neighbour quickly.

## Start from the product's metaphor

Ask what the collection is in real life, and let that decide how it moves. Fanned cards, tilted stacks and carousels are
what every template reaches for, so they say nothing about the product.

| The product is | Its collection could be | So the stage could be |
| --- | --- | --- |
| Modules of a business app | Files in a cabinet | A drawer you flip through, each card showing its tab |
| A process or a pipeline | Steps that hand over | A thread through the cards with something travelling on it |
| Bookings or scheduling | Days | A calendar strip that slides, the selected day opening up |
| Media or templates | A shelf of objects | Spines on a shelf that tip out when reached for |
| Maps or logistics | Places | Pins that lift off a map |

Each arrangement should also move differently under the hand: the example's drawer follows the pointer's height, its
thread follows its width.

## The engine, which matters more than any one effect

- **An arrangement is a pure function.** Index, focus and stage size go in, a pose comes out: `x, y, z, rotateX, rotateZ,
  scale, opacity`. Nothing else knows what an arrangement looks like, so any one can turn into any other. A new
  arrangement is one function.
- **Every card keeps a current pose and a velocity** and is pulled towards its goal by a critically damped spring
  (stiffness about 130, damping `2 * sqrt(stiffness)`). It arrives without overshoot and any move can be interrupted
  halfway. Do not build this from CSS transitions, keyframes or fixed timelines: they jump when interrupted, and on this
  stage people interrupt all the time.
- **Focus may be fractional.** Between two cards the poses blend, so the stage follows the hand instead of stepping.
- **Move only `transform` and `opacity`.** Request frames only while something is still moving; a resting stage costs
  nothing. Lines between moving cards are 1 px boxes with a transform: a full-page SVG redrawn each frame took this stage
  from 60 frames a second to under 2 in a software-rendered browser.
- **Leave as a wave.** When the arrangement changes, each card waits `distance from focus × 16 ms` before it sets off.
  Without this the change reads as a jump.

## The parts around the cards

- **Pointer maps to index.** Map the pointer's position across the stage to a focus value. Never test which card is under
  the pointer: the focused card moves, another lands under the pointer, and the set runs away from the hand. Where nothing
  moves, as on a grid, testing the card is fine. Ignore repeat events at the same position: browsers send them when
  something moves under a resting pointer, and they would take focus from the keyboard.
- **The words stay still.** Keep the name and one sentence in one fixed place and change them as focus changes, with a
  short rise and fade (under 350 ms). A thin line can tie them to the moving card. Still words are what make moving cards
  readable, and the card itself carries only a picture, a name and a label.
- **Thumbnails show what the thing does.** Rows arriving for orders, a line drawing itself for reports. Each is a small
  loop that runs only while its card is focused; the others hold a good still frame. Real pieces of the product beat
  drawings when the project has them.
- **Opening runs on the visitor's input.** Opening a card sends the others away, enlarges it in place and gives one control
  that changes a real result: their order count becomes a monthly figure and a chart. That says more than a pretty object
  with sliders, and more than a video of the feature. Close with the same button, Escape, or the card.
- **A guide cursor is optional.** It can walk through the stage after a few idle seconds or for a recording. It disappears
  for good at the first real pointer travel, changes no data, and does not exist on phones or under reduced motion.

## Build it so it can fail

- **No JavaScript:** the cards are an ordinary list of links or buttons in the page. The script adds the stage on top.
- **Phones:** no perspective and no pointer mapping. A sideways list with scroll snap, or a plain grid. Below about
  760 px the stage is switched off, not shrunk.
- **Reduced motion:** cards go straight to their pose with no spring, thumbnails stay still, and the guide cursor is off.
  Everything stays reachable.
- **Keyboard:** every card is a real button in reading order and arrow keys move between them. Focusing a card brings it
  into place, so far cards must stay focusable while faded: use `visibility: hidden` only while another card is open.
- **Screen readers:** the fixed words are `aria-live="polite"` and the focused card has `aria-current`.

## Check it by interrupting it

A stage like this looks fine until someone changes their mind. Before you hand it over: switch arrangement while the
previous change is still moving, sweep the pointer quickly back and forth, and tab through every card with a pointer
resting on the stage. Then record it and look at the frames, because a still screenshot says nothing here.

## What breaks it

- Bouncy easing, or anything that overshoots. It looks like a toy.
- Tilting everything by a lot. Past about 25 degrees the cards stop being readable.
- Two of these on one page, or using it for three items.
- Cards that hold paragraphs.
- A fan or carousel of cards chosen because it looks impressive, with nothing in the product behind it.
