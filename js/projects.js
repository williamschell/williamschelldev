/* ==========================================================================
   SITE CONTENT — this is the only file you need to edit.
   ==========================================================================

   ADDING A NEW PROJECT
   1. Put its images in /images/<slug>/  (e.g. images/my-game/cover.jpg)
   2. Copy one of the project blocks below, paste it where you want it in the
      list (the order here is the order on the page), and fill it in.
      Games go in window.PROJECTS, and software goes in window.SOFTWARE.
   3. Save, commit, push. Done.

   Cover images look best at about 1.28 : 1 (e.g. 1280 x 1000 px).
   Leave `cover` / `hoverCover` empty ("") and a colored placeholder is shown.
   Every project needs a unique slug, and "software" is taken by the Software page.

   OPTIONAL CARD LINES — leave any of these out and that line isn't shown:
     summary, teamSize, roles, dates
   OPTIONAL PAGE LINES: engine ("Engine: ..."), tech ("Built with: ...")

   PROJECT PAGE BLOCKS — stacked top to bottom on the project's page:
     { type: "heading",    text: "Section title" }
     { type: "subheading", text: "A smaller title inside a section" }
     { type: "text",       text: "A paragraph. Blank lines start new paragraphs." }
     { type: "list",       items: ["A bullet point", "Another bullet point"] }
     { type: "image",      src: "images/slug/shot.png", caption: "optional" }
     { type: "gallery",    images: ["images/slug/a.png", "images/slug/b.png"] }
     { type: "video",      youtube: "dQw4w9WgXcQ" }      // just the YouTube video ID
     { type: "video",      src: "images/slug/trailer.mp4" } // or a self-hosted file
     { type: "embed",      src: "https://itch.io/embed-upload/...", height: 600 }

   PAGE LAYOUT — every project follows the same order:
     Overview (what it is, how it was made, who helped)
     Achievements (bullet points, each starting with a strong verb and a number where possible)
     Design Process (one subheading per system or decision: the problem, what you tried, what changed)
   Anything in [square brackets] is a placeholder waiting for real details.
   ========================================================================== */

window.SITE = {
  name: "William Schell",
  aboutTitle: "About Me",
  about:
    "Hello! My name is William Schell. I have been coding and making video games " +
    "since I was just 12 years old! Ten years later, and I am much more vetted " +
    "in the profession now. I am slated to graduate from Virginia Tech in May of " +
     "2027 with a Bachelors in Computer Science. Below are some of the projects " +
     "I have worked on during my time here!",
  email: "williamschelldev@gmail.com",
  cv: "",            // link to your CV / resume (Google Drive, PDF in /images, etc.) — leave "" to hide
  socials: [
    // types with icons: linkedin, youtube, github, itch, email. Anything else shows a generic link icon.
    { type: "linkedin", url: "https://www.linkedin.com/in/william-schell/" },
    { type: "itch",     url: "https://duckzi8.itch.io/" },
    { type: "youtube",  url: "https://www.youtube.com/@your-handle" },
    { type: "email",    url: "mailto:williamschelldev@gmail.com" }
  ]
};

window.PROJECTS = [
  {
    slug: "Bullet Ant",          // used in the URL: williamschell.dev/#example-game-one
    title: "Bullet Ant",
    teamSize: "Solo",
    roles: "Game Design, Programming, 2D Art, Sound, Music",
    dates: "5 Day Game Jam, July 2026",
    cover: "images/bulletantcover.png",                          // e.g. "images/example-game-one/cover.png"
    hoverCover: "",                     // image shown when hovering the cover (optional)
    engine: "Godot 4.3",                // optional
    links: [
      { label: "Play on itch.io", url: "https://duckzi8.itch.io/bullet-ant" }
    ],
    blocks: [
      { type: "heading", text: "Overview" },
      { type: "text", text: "Bullet Ant is a high score boss rush. The bug fusion king of Yardia has stolen your nest's queen, and you are a bullet ant with, well, bullets. His endless army of fused bug bosses stands in your way: survive as long as you can and push for the top of the leaderboard.\n\nI built it solo in 5 days for the Stop Killing Games Community Jam 2026, whose theme was High Score Chasers. It's still in development, and the planned Steam release aims for 4000+ boss combinations along with refined graphics, audio and music." },
      { type: "gallery", images: ["images/bullet-ant/firefly-fight.jpg", "images/bullet-ant/beetle-fight.jpg"] },
      { type: "heading", text: "Achievements" },
      { type: "list", items: [
        "Designed and built a complete boss rush solo in 5 days, handling all code, art, sound and music.",
        "Created a modular fusion system where every boss is assembled from three parts, producing 125 unique bosses from 5 species.",
        "Integrated an online leaderboard with SilentWolf, turning a single-player game into a competition between players.",
        "[Add a result: jam placement, itch.io plays or ratings, or Steam wishlists.]"
      ] },
      { type: "heading", text: "Design Process" },
      { type: "subheading", text: "Fusion Bosses" },
      { type: "text", text: "Every boss is built from three parts: head, body and legs. Each part brings one attack, so a boss always fights with three, and each of its three phases powers them up. Building bosses out of parts let a small set of handmade pieces turn into far more fights than I could have made one at a time in 5 days.\n\nThe first three bosses are pure, a single species throughout, so players learn each species' attacks on their own. Bosses 4 and 5 fuse two species, and from boss 6 on they fuse three. With five species (Spider, Firefly, Rhino Beetle, Cicada and Asian Hornet), any part can pair with any other. A Rhino Beetle body hardens for 80% damage reduction, while a Cicada body sheds husks that turn into mini bosses if you don't destroy them in time.\n\n[What didn't work at first? For example, a fusion that was unfair or unreadable, and how you fixed it.]" },
      { type: "subheading", text: "Score as Currency" },
      { type: "text", text: "Your score is both the goal and the money. Everything in the shop is paid for out of it, so every upgrade is a real tradeoff: getting stronger means giving up points you're chasing.\n\nAfter each win you're graded S through F on weapon accuracy, damage received and time to complete, and those grades raise or lower your score multiplier. That rewards playing well, not just surviving." },
      { type: "subheading", text: "Weapons and Upgrades" },
      { type: "text", text: "The shop opens after every fight with one gun and two upgrades. You can only carry one gun, so buying a new one replaces yours. The eight guns range from a 30-round assault rifle to a single-shot sniper that deals 150 damage, and every gun appears once before any repeat, so a run always shows you the full range." }
    ]
  },
  {
    slug: "Cavity",
    title: "Cavity",
    teamSize: "Team of 2",
    roles: "Game Design, Programming, 2D Art, 3D Art, Sound, Music, Writing",
    dates: "14 Day Game Jam, July 2026",
    cover: "images/caivtycover.png",
    hoverCover: "",
    links: [{ label: "Download on itch.io", url: "https://duckzi8.itch.io/cavity" }],
    blocks: [
      { type: "heading", text: "Overview" },
      { type: "text", text: "Cavity is a rogue-like deck building TCG boss rush. You've signed up for the championship at Cavity, a hole-in-the-underground arena, and you have to beat 7 bosses in a row to take the title. Open card packs, tune your deck between rounds and keep in mind that not everyone gets to the end by playing fair. Eat or be eaten.\n\nA run takes anywhere from 10 to 30 minutes. I made the 2D art, 3D art, music (using free samples), story and code. [Teammate's name] did [their role]. I plan to keep working on the game after this release." },
      { type: "image", src: "images/cavity/table.jpg" },
      { type: "heading", text: "Achievements" },
      { type: "list", items: [
        "Built a complete rogue-like deckbuilder with 7 boss opponents in 14 days.",
        "Drew a pixel art scene for every critter card and built the 3D table and opponent they're played against.",
        "Wrote the story and produced the soundtrack from free samples.",
        "[Add a result: jam placement, itch.io downloads or ratings.]"
      ] },
      { type: "heading", text: "Design Process" },
      { type: "subheading", text: "Cute Cards, Vicious Game" },
      { type: "text", text: "The cards look cute and cuddly, but they're vicious. Each critter gets its own pixel art scene, which plays against the dark 3D table and the stranger waiting across it. That contrast sets the tone before the first card is played." },
      { type: "gallery", images: ["images/cavity/card-art-1.png", "images/cavity/card-art-2.png", "images/cavity/card-art-3.png", "images/cavity/card-art-4.png"] },
      { type: "subheading", text: "Balancing a Run" },
      { type: "text", text: "To win, you balance exertion, your card slots, your deck and your strategy. Card packs and deck changes between rounds let each run grow differently, while keeping a full run between 10 and 30 minutes.\n\n[How exertion works, and what changed in balancing after playtests.]" },
      { type: "image", src: "images/cavity/opponent.jpg" },
      { type: "subheading", text: "Opponents Who Don't Play Fair" },
      { type: "text", text: "[How bosses cheat or bend the rules, and how you made that feel fair to the player.]" }
    ]
  },
  {
    slug: "In Sheeps Clothing",
    title: "In Sheep's Clothing",
    teamSize: "Team of 2",
    roles: "Game Design, Writing, Programming, 3D Map Art, Sound",
    dates: "2 Day Personal Game Jam, August 2026",
    cover: "images/insheepsclothingcover.png",
    hoverCover: "",
    links: [{ label: "View on itch.io", url: "https://duckzi8.itch.io/in-sheeps-clothing" }],
    blocks: [
      { type: "heading", text: "Overview" },
      { type: "text", text: "Hello boss! You're a farmer keeping your flock safe. Every evening as you let your sheep in, several conniving wolves try to slip in with the herd, and one mistake can cost you several sheep overnight. Stay vigilant and watch your flock grow over the week.\n\nI made it in two days as a challenge to see how fast I could finish a game, like a game jam just for myself. I did the environment, gameplay, story and sound. The sheep and fox models were made by Chloe Dresner." },
      { type: "image", src: "images/in-sheeps-clothing/checkpoint.jpg", caption: "Every visitor at the gate has to be checked before you let them in or turn them away." },
      { type: "heading", text: "Achievements" },
      { type: "list", items: [
        "Designed and finished a complete game in 2 days as a self-set challenge.",
        "Created three separate ways to catch a wolf, each testing a different skill.",
        "Built the 3D farm environment, wrote the story and made the sound.",
        "[Add a result: itch.io plays, ratings or player feedback.]"
      ] },
      { type: "heading", text: "Design Process" },
      { type: "subheading", text: "Spot the Wolf" },
      { type: "text", text: "You have three ways to catch a wolf: have the sheep repeat a phrase after you, verify its ID against the database, and look closely for any sign of a wolf peeking out of its sheep costume. Each one asks for a different kind of attention (listening, checking records and looking), so no single habit is enough to catch every wolf.\n\n[Which check did players rely on most, and did you change anything because of it?]" },
      { type: "gallery", images: ["images/in-sheeps-clothing/approach.jpg", "images/in-sheeps-clothing/story.jpg"] },
      { type: "subheading", text: "Raising the Stakes Over a Week" },
      { type: "text", text: "One mistake can cost several sheep overnight, and the flock grows over the week, so every decision at the gate carries weight. [How the days get harder as the week goes on.]" },
      { type: "subheading", text: "Scoping for Two Days" },
      { type: "text", text: "[What you cut or simplified to finish in two days, and what you'd add with more time.]" }
    ]
  },
  {
    slug: "Autumn Painting",
    title: "Autumn Painting",
    teamSize: "Team of 2",
    roles: "Team lead, Programming, Map Design, Game Design, 3D Art, Audio",
    dates: "48-hour Game Jam, 2026",
    cover: "images/autumnpaintingcover.png",
    hoverCover: "",
    links: [{ label: "Download on itch.io", url: "https://duckzi8.itch.io/autumn-painting" }],
    blocks: [
      { type: "heading", text: "Overview" },
      { type: "text", text: "Autumn truly is a beautiful time of the year! Autumn Painting is a cozy, artsy multiplayer game set in a park inspired by Acadia National Park. Join friends or strangers, then go on a hike, chat, paint or take photos, and keep your eyes open for wildlife.\n\nWe made it for the Autumn Jam 2026, and a full release on Steam is planned with much more content. I led the team and did the programming, game design, map design and audio. Character design was by Chloe Dresner, and we shared the 3D art." },
      { type: "image", src: "images/autumn-painting/painting.jpg", caption: "Set up an easel anywhere in the park and paint what you see." },
      { type: "heading", text: "Achievements" },
      { type: "list", items: [
        "Led a team of 2 to ship an online multiplayer game in 48 hours.",
        "Built the game's Steam multiplayer, with public, private and local lobbies.",
        "Designed a park map inspired by Acadia National Park.",
        "[Add a result: jam placement, downloads, or Steam page wishlists.]"
      ] },
      { type: "heading", text: "Design Process" },
      { type: "subheading", text: "A Game Without Goals" },
      { type: "text", text: "There are no goals, just things to enjoy. You can place an easel and paint, pull out a camera and show photos from your album to other players, chat, customize your character and change the time of day. Every activity is something to share with the people around you, which keeps the focus on being together." },
      { type: "gallery", images: ["images/autumn-painting/character.jpg", "images/autumn-painting/camera.jpg"] },
      { type: "subheading", text: "Multiplayer" },
      { type: "text", text: "I built the game's Steam infrastructure. Players can host a public lobby for anyone to join, a private one for invited friends, or a local one for solo play. [The hardest part of getting it working in 48 hours.]" },
      { type: "subheading", text: "Bringing Acadia to the Map" },
      { type: "text", text: "[What you took from Acadia National Park, and how you laid out the trails and views.]" }
    ]
  },
  {
    slug: "An Odd Case",
    title: "An Odd Case",
    teamSize: "Solo",
    roles: "Game Design, Programming, Sound",
    dates: "VTGDC Fall 2026 Game Jam",
    cover: "images/anoddcasecover.png",
    hoverCover: "",
    engine: "Godot",
    links: [{ label: "Play on itch.io", url: "https://duckzi8.itch.io/odd-crimes" }],
    blocks: [
      { type: "heading", text: "Overview" },
      { type: "text", text: "The year is 3050. You're a detective in the city, and after a rough last year, the only cases you get are the ones deemed too silly for anyone else to handle. They have no clue how serious they truly are.\n\nAn Odd Case is an online multiplayer shooter that runs in the browser on an always-on server, so anyone can hop in at any time. I made it solo in Godot for the VTGDC Fall 2026 jam. Music and sounds were either recorded by me or downloaded for free from Pixabay." },
      { type: "heading", text: "Achievements" },
      { type: "list", items: [
        "Built an online multiplayer shooter that runs in the browser on an always-on server.",
        "Designed a server-wide boss fight that every player chips away at together across sessions.",
        "Wrote about 70% of the code new for the jam while losing most of a day to other commitments.",
        "[Add a result: jam placement, number of players, or bosses defeated.]"
      ] },
      { type: "heading", text: "Design Process" },
      { type: "subheading", text: "A Shared Boss Fight" },
      { type: "text", text: "The whole server works together over time to defeat a boss. It's meant to take a while, with players chipping away at it across sessions, and there's always another boss behind it. Players vote on a lead at the job board in their office, then head out to take it on. Because the server is always on, progress keeps going even when you log off." },
      { type: "subheading", text: "Scarce Ammo, Forced Teamwork" },
      { type: "text", text: "Everyone gets a minimal number of bullets per round, which makes teamwork crucial: nobody can carry a fight alone. The game is still playable when nobody else is online, and you can always just chat with friends." },
      { type: "subheading", text: "Working Under a Time Crunch" },
      { type: "text", text: "I was unable to work on the game for much of the jam's Saturday, so I repurposed some code from older projects and wrote about 70% of the code new for this one. [What you cut to make the deadline.]" }
    ]
  },
  {
    slug: "Mira",
    title: "Mira",
    teamSize: "Solo",
    roles: "Game Design, Programming, 3D Art, Writing, Music",
    dates: "3 Day Game Jam",
    cover: "images/miracover.jpg",
    hoverCover: "",
    links: [{ label: "Download on itch.io", url: "https://duckzi8.itch.io/mira" }],
    blocks: [
      { type: "heading", text: "Overview" },
      { type: "text", text: "Mira is a short, atmospheric sci-fi experience set on the planet Rema. You play as Rea, a girl living with her father in their sheltered home city after her mother's mysterious disappearance, and discover her world alongside her.\n\nIt's a story about memory, addiction and carving your own path, with an original soundtrack and an atmospheric 3D open world to explore. I made it solo over 3 days for a game jam, and it was my first ever 3D game." },
      { type: "gallery", images: ["images/mira/street.jpg", "images/mira/alley.jpg", "images/mira/lamp.jpg"] },
      { type: "heading", text: "Achievements" },
      { type: "list", items: [
        "Made my first 3D game solo in 3 days, including the world, story and code.",
        "Composed an original soundtrack for the game.",
        "Built an explorable 3D open world focused on atmosphere and storytelling.",
        "[Add a result: jam placement, downloads or ratings.]"
      ] },
      { type: "heading", text: "Design Process" },
      { type: "subheading", text: "Atmosphere First" },
      { type: "text", text: "As my first 3D game, I focused on atmosphere and storytelling rather than complex mechanics. [How lighting, music and the city's layout set the mood.]" },
      { type: "subheading", text: "Telling Rea's Story" },
      { type: "text", text: "[How the story is told as you explore: dialogue, objects, places.]" },
      { type: "subheading", text: "Looking Back" },
      { type: "text", text: "I hope to give Mira a complete art and music overhaul one day. [What you learned here that you used in later 3D games.]" }
    ]
  }
];

window.SOFTWARE = [
  {
    slug: "Splotchle",
    title: "Splotchle",
    summary: "A daily drawing challenge.",
    teamSize: "Solo",
    roles: "Design, Programming",
    tech: "JavaScript, Canvas, Supabase",
    cover: "images/splotchlecover.png",
    links: [{ label: "Open Splotchle", url: "splotchle/" }],
    blocks: [
      { type: "heading", text: "Overview" },
      { type: "text", text: "Splotchle is a daily drawing challenge. Everyone gets the same weird blob each day. Draw whatever you see in it, post it to the public gallery, and like what other people came up with. Free play offers endless new blobs, and those drawings can be shared in their own Unlimiteds gallery." },
      { type: "heading", text: "Achievements" },
      { type: "list", items: [
        "Generated a new blob every day entirely in the browser, identical for every player, with no server involved.",
        "Built a drawing studio with textured brushes, flood fill, an eraser and undo/redo.",
        "Ran public galleries on Supabase, secured entirely by database rules rather than client code.",
        "Kept the first load under 200 KB with plain JavaScript and no build step.",
        "[Add a result: number of players, drawings posted or longest streak.]"
      ] },
      { type: "heading", text: "Design Process" },
      { type: "subheading", text: "Generating the Blob" },
      { type: "text", text: "Each blob is generated from a seed using metaballs, noise and marching squares, then smoothed into curves. The same seed always gives the same shape, so the daily blob is just the date turned into a seed, and a blob can be shared as a link." },
      { type: "subheading", text: "One Blob for Everyone" },
      { type: "text", text: "Like Wordle, everyone gets the same challenge each day, which is what makes the gallery interesting: you see how differently people read the same shape. Gallery cards show each drawing side by side with its blob, and the app tracks your daily streak." },
      { type: "subheading", text: "Galleries and Safety" },
      { type: "text", text: "Posting uses anonymous accounts, so there's no sign-up. Every rule about who can post, like or report is enforced by the database itself, and drawing, saving and streaks all keep working offline." }
    ]
  },
  {
    slug: "Novle",
    title: "Novle",
    summary: "A daily short story challenge with one prompt for everyone.",
    teamSize: "Solo",
    roles: "Design, Programming, Writing",
    tech: "JavaScript, Supabase",
    cover: "images/novlecover.png",
    links: [{ label: "Open Novle", url: "novle/" }],
    blocks: [
      { type: "heading", text: "Overview" },
      { type: "text", text: "Novle is a daily short story challenge. Everyone gets the same prompt, genre and word limit each day. Write a story, post it to the public gallery, and like the ones other people wrote. Practice mode is there for writing outside the daily challenge." },
      { type: "heading", text: "Achievements" },
      { type: "list", items: [
        "Generated a daily prompt, genre and word limit from the date alone, so every writer gets the same challenge, even offline.",
        "Made writing, autosaving drafts and streaks work without a connection.",
        "Ran a public story gallery with likes on Supabase.",
        "[Add a result: number of writers or stories posted.]"
      ] },
      { type: "heading", text: "Design Process" },
      { type: "subheading", text: "A Prompt from the Date" },
      { type: "text", text: "Each day's challenge is computed in the browser from the date, so there's no server to wait on and every writer sees the same prompt at local midnight. The prompts come from a hand-written bank that's easy to grow." },
      { type: "subheading", text: "Writing First" },
      { type: "text", text: "Drafts autosave about once a second, and saving a story counts toward your streak whether or not you post it. Posting is optional, so the daily habit doesn't depend on sharing." }
    ]
  },
  {
    slug: "Streakle",
    title: "Streakle",
    summary: "One page for all your daily games, with streaks and leaderboards.",
    teamSize: "Solo",
    roles: "Design, Programming",
    tech: "JavaScript, Supabase",
    dates: "November 2026",
    cover: "",
    links: [{ label: "Open Streakle", url: "gametracker/" }],
    blocks: [
      { type: "heading", text: "Overview" },
      { type: "text", text: "Streakle keeps track of the daily web games you play, like Wordle, Connections, Krillion and Splotchle. Keep your list on one page, jump to each game, paste your result, keep your streaks, and compare scores with friends and everyone else.\n\nIt's styled like a spiral notepad, with games as a to-do list and anything you can add pinned on as a sticky note." },
      { type: "heading", text: "Achievements" },
      { type: "list", items: [
        "Supported 24 daily games out of the box, reading pasted share text for 19 of them, plus custom games.",
        "Designed an overall leaderboard that fairly combines very different scores (guesses, times, points and percentages) into one daily ranking.",
        "Built username and password accounts that sync your whole history across devices.",
        "Covered the app and its database rules with 206 automated end-to-end checks."
      ] },
      { type: "heading", text: "Design Process" },
      { type: "subheading", text: "Comparing Scores That Don't Compare" },
      { type: "text", text: "Every game scores differently: Wordle counts guesses, the Mini counts seconds, Krillion awards points and Enclose Horse gives a percentage. For the overall board, finishing any game earns 50 points, and how well you did adds up to 50 more. Games with a fixed scale are scored on it, and the rest are scored against the best result on the board. Your day is the total, so finishing more games matters, and one lucky Wordle can't win the day." },
      { type: "subheading", text: "Local First, Then Accounts" },
      { type: "text", text: "Streakle works in the browser with no account at all. But clearing browsing data would wipe a player's whole history, so I added accounts with just a username and password, which suits a game shared between friends. Signing in merges what's in the browser into the account, and every device keeps a copy." },
      { type: "subheading", text: "A Notepad Look" },
      { type: "text", text: "[Why the notepad style, and how sticky notes and index cards map to the app's actions.]" }
    ]
  },
  {
    slug: "Worldbuilder",
    title: "Worldbuilder",
    summary: "A 3D map and codex for building a fictional universe.",
    teamSize: "Solo",
    roles: "Design, Programming",
    tech: "JavaScript, three.js",
    cover: "images/worldbuildercover.png",
    links: [{ label: "Open Worldbuilder", url: "worldbuilder/" }],
    blocks: [
      { type: "heading", text: "Overview" },
      { type: "text", text: "Worldbuilder is a tool for building a fictional universe. Lay it out on a 3D map, with star systems, free worlds, binary pairs and stations that you can drag into place. Alongside the map, a codex keeps track of its peoples, factions, characters, religions, languages, technology, animals and plants." },
      { type: "heading", text: "Achievements" },
      { type: "list", items: [
        "Built an interactive 3D map where star systems, worlds and stations can be dragged into place.",
        "Designed a codex covering 9 kinds of entries, from factions to plants, with built-in search.",
        "Added export and import, so a universe can be backed up and shared.",
        "[Add a result: what you or others have built with it.]"
      ] },
      { type: "heading", text: "Design Process" },
      { type: "subheading", text: "The Map" },
      { type: "text", text: "[Why a 3D map, and how you kept it easy to place and move things in 3D.]" },
      { type: "subheading", text: "The Codex" },
      { type: "text", text: "[How the codex is organized, and how entries connect to places on the map.]" }
    ]
  },
  {
    slug: "Spinner",
    title: "Spinner",
    summary: "Chain spinning wheels together to generate anything.",
    teamSize: "Solo",
    roles: "Design, Programming",
    cover: "images/spinnercover.png",
    links: [{ label: "Open Spinner", url: "spinner/" }],
    blocks: [
      { type: "heading", text: "Overview" },
      { type: "text", text: "Spinner links decision wheels into chains, so a series of spins can generate anything. It starts with a sample chain that generates a character for Deadlock, and you can build your own wheels and sort them into folders." },
      { type: "heading", text: "Achievements" },
      { type: "list", items: [
        "Designed a branching chain system where any single result can change which wheel comes next.",
        "Built a chain map that shows how every wheel connects.",
        "Included a ready-made Deadlock character generator as a sample chain.",
        "[Add a result: who uses it and for what.]"
      ] },
      { type: "heading", text: "Design Process" },
      { type: "subheading", text: "Chains and Branches" },
      { type: "text", text: "Each wheel can lead to a default next wheel, and any single entry can branch somewhere else, so one result can change what gets asked next. [What made you want branching rather than a fixed list of wheels.]" },
      { type: "subheading", text: "Seeing the Whole Chain" },
      { type: "text", text: "Branches get hard to follow quickly, so a chain map shows how the wheels connect. [How the map evolved.]" }
    ]
  }
];
