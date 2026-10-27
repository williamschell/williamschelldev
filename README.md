# williamschell.dev

A static portfolio site. It has no build step and no framework: just HTML, CSS and JS, so it runs on any static host.

```
index.html        page shell (rarely edited)
css/style.css     all styling; colors and fonts are at the top under :root
js/projects.js    ← ALL YOUR CONTENT: name, bio, socials, and the project list
js/site.js        renders the grid and project pages (no need to edit)
images/           put project images here, one folder per project
CNAME             tells GitHub Pages to serve this at williamschell.dev
```

## Adding a game

1. Make a folder `images/<slug>/` and drop in a cover image (about 1.28:1, e.g. 1280×1000), an optional hover image, and any screenshots.
2. In `js/projects.js`, copy an existing project entry and paste it where it should appear. The list order is the homepage order, so put new games at the top.
3. Fill in `slug`, `title`, `teamSize`, `roles`, `dates`, `cover`, `hoverCover`, `links`, and the `blocks` that make up the project page (text, headings, images, galleries, YouTube videos, itch.io embeds). The block types are documented at the top of that file.
4. Commit and push. The project gets a cover on the homepage and its own page at `williamschell.dev/#<slug>`.

To hide a project without deleting it, add `hidden: true`.

## Previewing locally

Open `index.html` in a browser. It works straight from disk.

## Hosting on GitHub Pages (free, HTTPS included)

`.dev` domains *require* HTTPS. GitHub Pages provides it automatically.

1. Create a GitHub repo (e.g. `williamschell.dev`) and push these files to the `main` branch.
2. Go to repo **Settings → Pages**, set Source to "Deploy from a branch", choose `main` / root, and save.
3. Under **Custom domain**, enter `williamschell.dev` (the CNAME file already has it).
4. At your domain registrar, add these DNS records:
   - `A` records for `@` pointing to `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - `CNAME` record for `www` pointing to `<your-github-username>.github.io`
5. Once DNS resolves (from a few minutes up to a few hours), tick **Enforce HTTPS** in Settings → Pages.

Netlify and Cloudflare Pages also work: drag the folder in, or connect the repo, then add the custom domain.
