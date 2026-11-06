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

   PROJECT PAGE BLOCKS — stacked top to bottom on the project's page:
     { type: "heading", text: "Section title" }
     { type: "text",    text: "A paragraph. Blank lines start new paragraphs." }
     { type: "image",   src: "images/slug/shot.png", caption: "optional" }
     { type: "gallery", images: ["images/slug/a.png", "images/slug/b.png"] }
     { type: "video",   youtube: "dQw4w9WgXcQ" }      // just the YouTube video ID
     { type: "video",   src: "images/slug/trailer.mp4" } // or a self-hosted file
     { type: "embed",   src: "https://itch.io/embed-upload/...", height: 600 }
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
      { type: "text", text: "The bug fusion king of Yardia has stolen your nest's queen. You are a bullet ant with, well, bullets, and his endless army of fused bug bosses stands in your way. Bullet Ant is a boss rush built around chasing a high score: survive as long as you can and push for the top of the leaderboard.\n\nI built it solo in 5 days for the Stop Killing Games Community Jam 2026, whose theme was High Score Chasers. It's still in development, and the planned Steam release aims for 4000+ boss combinations along with refined graphics, audio and music." },
      { type: "gallery", images: ["images/bullet-ant/firefly-fight.jpg", "images/bullet-ant/beetle-fight.jpg"] },
      { type: "heading", text: "Fusion Bosses" },
      { type: "text", text: "Every boss is built from three parts: head, body and legs. Each part brings one attack, so a boss always fights with three, and each of its three phases powers them up. The first three bosses are pure, a single species throughout. Bosses 4 and 5 fuse two species, and from boss 6 on they fuse three.\n\nWith five species in the game (Spider, Firefly, Rhino Beetle, Cicada and Asian Hornet), any part can pair with any other, giving 125 possible combinations. A Rhino Beetle body hardens for 80% damage reduction, while a Cicada body sheds husks that turn into mini bosses if you don't destroy them in time." },
      { type: "heading", text: "Score as Currency" },
      { type: "text", text: "Your score is both the goal and the money. Everything in the shop is paid for out of it, so every upgrade costs you points. After each win you're graded S through F on weapon accuracy, damage received and time to complete, and those grades raise or lower your score multiplier." },
      { type: "heading", text: "Weapons and Upgrades" },
      { type: "text", text: "The shop opens after every fight with one gun and two upgrades. You can only carry one gun, so buying a new one replaces yours. The eight guns range from a 30-round assault rifle to a single-shot sniper that deals 150 damage, and every gun appears once before any repeat." },
      { type: "heading", text: "Credits" },
      { type: "text", text: "Art, code and design by me. Built in Godot 4.3, with the leaderboard powered by SilentWolf." }
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
      { type: "text", text: "Cavity is a rogue-like deck building TCG boss rush. You've signed up for the championship at Cavity, a hole-in-the-underground arena, and you have to beat 7 bosses in a row to take the title. Open card packs, tune your deck between rounds and keep in mind that not everyone gets to the end by playing fair. Eat or be eaten.\n\nA run takes anywhere from 10 to 30 minutes." },
      { type: "image", src: "images/cavity/table.jpg" },
      { type: "image", src: "images/cavity/opponent.jpg" },
      { type: "heading", text: "Cute Cards, Vicious Game" },
      { type: "text", text: "The cards look cute and cuddly, but they're vicious. Each critter gets its own pixel art scene, which plays against the dark 3D table and the stranger waiting across it. To win, you balance exertion, your card slots, your deck and your strategy." },
      { type: "gallery", images: ["images/cavity/card-art-1.png", "images/cavity/card-art-2.png", "images/cavity/card-art-3.png", "images/cavity/card-art-4.png"] },
      { type: "heading", text: "What I Made" },
      { type: "text", text: "The 2D art, 3D art, music (using free samples), story and code. I plan to keep working on the game after this release." }
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
      { type: "text", text: "Hello boss! You're a farmer keeping your flock safe. Every evening as you let your sheep in, several conniving wolves try to slip in with the herd, and one mistake can cost you several sheep overnight. Stay vigilant and watch your flock grow over the week.\n\nI made it in two days as a challenge to see how fast I could finish a game, like a game jam just for myself." },
      { type: "image", src: "images/in-sheeps-clothing/checkpoint.jpg", caption: "Every visitor at the gate has to be checked before you let them in or turn them away." },
      { type: "heading", text: "Spot the Wolf" },
      { type: "text", text: "You have three ways to catch a wolf: have the sheep repeat a phrase after you, verify its ID against the database, and look closely for any sign of a wolf peeking out of its sheep costume." },
      { type: "gallery", images: ["images/in-sheeps-clothing/approach.jpg","images/in-sheeps-clothing/story.jpg"] },
      { type: "heading", text: "Credits" },
      { type: "text", text: "I did the environment, gameplay, story and sound. The sheep and fox were made by Chloe Dresner." }
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
      { type: "text", text: "Autumn truly is a beautiful time of the year! Autumn Painting is a cozy, artsy multiplayer game set in a park inspired by Acadia National Park. Join friends or strangers, then go on a hike, chat, paint or take photos, and keep your eyes open for wildlife.\n\nWe made it for the Autumn Jam 2026, and a full release on Steam is planned with much more content." },
      { type: "image", src: "images/autumn-painting/painting.jpg", caption: "Set up an easel anywhere in the park and paint what you see." },
      { type: "heading", text: "Things to Do Together" },
      { type: "text", text: "There are no goals, just things to enjoy. You can place an easel and paint, pull out a camera and show photos from your album to other players, chat, customize your character and change the time of day." },
      { type: "gallery", images: ["images/autumn-painting/character.jpg", "images/autumn-painting/camera.jpg"] },
      { type: "heading", text: "Multiplayer" },
      { type: "text", text: "I built the game's Steam infrastructure. Players can host a public lobby for anyone to join, a private one for invited friends, or a local one for solo play." },
      { type: "heading", text: "Credits" },
      { type: "text", text: "Programming and game design by me, with map design and audio. Character design by Chloe Dresner. We shared the 3D art." }
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
      { type: "text", text: "The year is 3050. You're a detective in the city, and after a rough last year, the only cases you get are the ones deemed too silly for anyone else to handle. They have no clue how serious they truly are.\n\nAn Odd Case is an online multiplayer shooter that runs in the browser on an always-on server, so anyone can hop in at any time. I made it in Godot for the VTGDC Fall 2026 jam." },
      { type: "heading", text: "A Shared Boss Fight" },
      { type: "text", text: "The whole server works together over time to defeat a boss. It's meant to take a while, with players chipping away at it across sessions, and there's always another boss behind it. Players vote on a lead at the job board in their office, then head out to take it on.\n\nEveryone gets a minimal number of bullets per round, which makes teamwork crucial. The game is still playable when nobody else is online, and you can always just chat with friends." },
      { type: "heading", text: "Working Under a Time Crunch" },
      { type: "text", text: "I was unable to work on the game for much of the jam's Saturday, so I repurposed some code from older projects and wrote about 70% of the code new for this one." },
      { type: "heading", text: "Credits" },
      { type: "text", text: "Code and design by me. Music and sounds were either recorded by me or downloaded for free from Pixabay." }
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
      { type: "text", text: "Mira is a short, atmospheric sci-fi experience set on the planet Rema. You play as Rea, a girl living with her father in their sheltered home city after her mother's mysterious disappearance, and discover her world alongside her.\n\nIt's a story about memory, addiction and carving your own path, with an original soundtrack and an atmospheric 3D open world to explore." },
      { type: "gallery", images: ["images/mira/street.jpg", "images/mira/alley.jpg", "images/mira/lamp.jpg"] },
      { type: "heading", text: "My First 3D Game" },
      { type: "text", text: "I made Mira over 3 days for a game jam, and it was my first ever 3D game. I focused on atmosphere and storytelling, and I hope to give it a complete art and music overhaul one day." }
    ]
  }
];

window.SOFTWARE = [
  {
    slug: "Splotchle",
    title: "Splotchle",
    summary: "A daily drawing challenge: turn a weird blob into a character.",
    cover: "images/splotchlecover.png",
    links: [{ label: "Open Splotchle", url: "splotchle/" }],
    blocks: [
      { type: "text", text: "Everyone gets the same weird blob each day. Draw whatever you see in it, post it to the public gallery, and like what other people came up with. Free play offers endless new blobs, and those drawings can be shared in their own Unlimiteds gallery.\n\nEach blob is generated in the browser from a seed, using metaballs, noise and marching squares, so the same seed always gives the same shape. The app is plain JavaScript with no build step, and it uses Supabase for the public galleries." }
    ]
  },
  {
    slug: "Worldbuilder",
    title: "Worldbuilder",
    summary: "A 3D map and codex for building a fictional universe.",
    cover: "images/worldbuildercover.png",
    links: [{ label: "Open Worldbuilder", url: "worldbuilder/" }],
    blocks: [
      { type: "text", text: "Lay out a universe on a 3D map, with star systems, free worlds, binary pairs and stations that you can drag into place. Alongside the map, a codex keeps track of its peoples, factions, characters, religions, languages, technology, animals and plants.\n\nIt has a built-in search, and a universe can be exported and imported." }
    ]
  },
  {
    slug: "Spinner",
    title: "Spinner",
    summary: "Chain spinning wheels together to generate anything.",
    cover: "images/spinnercover.png",
    links: [{ label: "Open Spinner", url: "spinner/" }],
    blocks: [
      { type: "text", text: "Spinner links decision wheels into chains. Each wheel can lead to a default next wheel, and any single entry can branch somewhere else, so one result can change what gets asked next. A chain map shows how the wheels connect.\n\nIt starts with a sample chain that generates a character for Deadlock, and you can build your own wheels and sort them into folders." }
    ]
  },
  {
    slug: "Novle",
    title: "Novle",
    summary: "A daily short story challenge with one prompt for everyone.",
    cover: "images/novlecover.png",
    links: [{ label: "Open Novle", url: "novle/" }],
    blocks: [
      { type: "text", text: "Everyone gets the same prompt, genre and word limit each day. Write a story, post it to the public gallery, and like the ones other people wrote. Practice mode is there for writing outside the daily challenge.\n\nWriting, saving and drafts all work without a connection, and Supabase powers the public gallery." }
    ]
  }
];
