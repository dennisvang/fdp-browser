import { ResourceViewer } from "./modules/viewer";

// todo: consistent naming IRI/URI/URL throughout all modules

let viewer;

const inputUrl: HTMLElement | null = document.getElementById("input-url");

if (inputUrl instanceof HTMLElement) {
    // create new viewer when fdp url changes
    inputUrl.addEventListener("change", async (event) => {
        const container = document.getElementById("content");
        if (container instanceof HTMLDivElement && event.target instanceof HTMLInputElement) {
            // todo: validate url and/or allow domain entry (without the scheme://)
            viewer = new ResourceViewer(container, event.target.value);
            // initialize rdf context and populate page
            await viewer.initialize();
        }
    });

    // initialize
    inputUrl.dispatchEvent(new Event("change"));
}
