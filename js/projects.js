/* ==========================================================================
   SITE CONTENT — this is the only file you need to edit.
   ==========================================================================

   ADDING A NEW PROJECT
   1. Put its images in /images/<slug>/  (e.g. images/my-game/cover.jpg)
   2. Copy one of the project blocks below, paste it where you want it in the
      list (the order here is the order on the homepage), and fill it in.
   3. Save, commit, push. Done.

   Cover images look best at about 1.28 : 1 (e.g. 1280 x 1000 px).
   Leave `cover` / `hoverCover` empty ("") and a colored placeholder is shown.

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
    "Hi there! I'm William. Write a couple of sentences here about who you are, " +
    "what kinds of games you make, and what you're working on right now.",
  email: "wschell1015@vt.edu",
  cv: "",            // link to your CV / resume (Google Drive, PDF in /images, etc.) — leave "" to hide
  socials: [
    // types with icons: linkedin, youtube, github, itch, email. Anything else shows a generic link icon.
    { type: "linkedin", url: "https://www.linkedin.com/in/your-handle/" },
    { type: "itch",     url: "https://your-handle.itch.io/" },
    { type: "youtube",  url: "https://www.youtube.com/@your-handle" },
    { type: "email",    url: "mailto:wschell1015@vt.edu" }
  ]
};

window.PROJECTS = [
  {
    slug: "example-game-one",          // used in the URL: williamschell.dev/#example-game-one
    title: "Example Game One",
    teamSize: "Solo",
    roles: "Game Design, Programming, 2D Art",
    dates: "February 2025 - Present",
    cover: "",                          // e.g. "images/example-game-one/cover.png"
    hoverCover: "",                     // image shown when hovering the cover (optional)
    engine: "Unity",                    // optional
    links: [
      { label: "Play on itch.io", url: "https://itch.io/" }
    ],
    blocks: [
      { type: "text", text: "A short pitch for the game: what it is, what the player does, and what makes it interesting.\n\nWhat you personally built, the hardest design problem you solved, and what you learned." },
      { type: "heading", text: "Design Highlights" },
      { type: "text", text: "Replace this with screenshots, GIFs, a trailer, design docs, whatever shows the work best." }
    ]
  },
  {
    slug: "example-game-two",
    title: "Example Game Two",
    teamSize: "Team of 4",
    roles: "Lead Design, Systems Programming",
    dates: "January 2024 - May 2024",
    cover: "",
    hoverCover: "",
    links: [],
    blocks: [
      { type: "text", text: "Project description goes here." }
    ]
  },
  {
    slug: "example-game-three",
    title: "Example Game Three",
    teamSize: "Solo",
    roles: "Game Design, Writing",
    dates: "September 2023",
    cover: "",
    hoverCover: "",
    links: [],
    blocks: [
      { type: "text", text: "Project description goes here." }
    ]
  },
  {
    slug: "example-game-four",
    title: "Example Game Four",
    teamSize: "Game Jam Team of 3",
    roles: "Programming, Level Design",
    dates: "48-hour Game Jam, 2023",
    cover: "",
    hoverCover: "",
    links: [],
    blocks: [
      { type: "text", text: "Project description goes here." }
    ]
  }
];
