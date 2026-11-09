import { MEDIATYPE_TURTLE, RdfStore } from "./rdf";
import type {Quad, Quad_Object, Quad_Subject, Term} from "n3";

const CLASS_CLICKABLE = "clickable";
const CLASS_RDF_STATEMENT = "rdf-statement";
const CLASS_RDF_TERM = "rdf-term";
const CLASS_NAVIGATION_RESOURCE = "nav-resource";
const CLASS_PREFIX = "prefix";
const CLASS_PREFIX_FAILED = "prefix-failed";
const CLASS_PREFIX_HARVESTED = "prefix-harvested";
const CLASS_PREFIX_LIST = "prefix-list";
const CLASS_PREFIXES = "prefixes";
const CLASS_SUBJECT = "subject";
const CLASS_SUBJECT_TITLE = "subject-title";
const CLASS_TITLE = "title";
const PARAM_NAVIGATION_URL = "nav-url";
const PREDICATE_DCTERMS_TITLE = "http://purl.org/dc/terms/title";
const PREDICATE_RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";

/** Maintains resource viewer state */
export class ResourceViewer {
    // private elements
    #container: HTMLDivElement;
    #rdfStore: RdfStore;
    #relatedResourceIris: string[];
    #rootUrl: string;

    constructor(container: HTMLDivElement, rootUrl: string) {
        this.#container = container;
        this.#rootUrl = rootUrl;
        // initialize empty
        this.#rdfStore = new RdfStore();
        this.#relatedResourceIris = [];
        // intercept navigation events
        navigation.addEventListener("navigate", this.#navigationHandler.bind(this));
        console.info("viewer created for %s", this.#rootUrl)
    }

    /** Handles navigation events using the JavaScript navigation API */
    #navigationHandler(event: NavigateEvent): void {
        console.debug("nav event detected: %s, %s", event.navigationType, event.destination.url)
        // only same-origin navigation is handled here, which implies an internal
        // nav-url parameter is available
        event.intercept({
            handler: async () => {
                // note that, at this point, the location has already changed so it
                // matches the destination
                const destinationUrl = new URL(event.destination.url);
                const navigationUrl = destinationUrl.searchParams.get(PARAM_NAVIGATION_URL);
                console.debug("intercepted navigation to %s", navigationUrl)
                await this.#update(navigationUrl);
            }
        });
    }

    /**
     * Harvests RDF-turtle from known ontologies/vocabularies to provide context for
     * reasoning, human readable labels, and so on.
     * Then navigates to the root URL to populate the page.
     */
    async initialize(): Promise<void> {
        // navigate to root URL, using history "replace" to prevent the user from
        // going back to any previous root URL (from different FDP)
        const destinationUrl = new URL(window.location.toString());
        destinationUrl.searchParams.set(PARAM_NAVIGATION_URL, this.#rootUrl);
        navigation.navigate(destinationUrl, {"history": "replace"});
    }

    /** Updates the whole content based on the specified url */
    async #update(url: string | null): Promise<void> {
        // fall back on root url if no url was provided
        const resourceUrl = url || this.#rootUrl;
        // harvest resource statements and add them to the rdf store
        await this.#harvest(resourceUrl);
        // find uris representing navigation resources, for internal navigation
        const subjectIris = this.#workaroundPossibleSubjectIris(resourceUrl);
        this.#relatedResourceIris = this.#rdfStore.getRelatedResourceIris(subjectIris);
        // populate the content container based on the harvested resource
        await this.#populate(resourceUrl);
    }

    /**
     * Returns an array of possible RDF subject IRIs based on the specified resourceUrl.
     * This is an ugly workaround for possible mismatch between scheme and path of the
     * HTTP request URL and the RDF subject URI.
     */
    #workaroundPossibleSubjectIris(resourceUrl: string): string[] {
        console.info("using subject URI workaround...")
        let subjectIris = [resourceUrl];
        const url = new URL(resourceUrl);
        // the workaround only applies to the root (i.e. no path "" or empty path "/")
        const rootPaths = ["", "/"];
        if (rootPaths.includes(url.pathname)) {
            subjectIris = [];
            // create all combinations of scheme and root path
            ["http", "https"].forEach(scheme => {
                rootPaths.forEach(path => {
                    url.protocol = scheme;
                    subjectIris.push(url.origin + path);
                });
            });
        }
        console.info(subjectIris)
        return subjectIris
    }

    /** Replaces IRIs with corresponding prefixes */
    #withPrefixes(value: string): string {
        for (const [prefix, prefixIRI] of Object.entries(this.#rdfStore.getPrefixes())) {
            value = value.replace(prefixIRI, prefix + ":");
        }
        return value;
    }

    /** Tries to get a human readable label for an IRI */
    #getLabel(iri: string, language="en"): string {
        // default to prefix substitution
        let label = this.#withPrefixes(iri);
        // try to get actual label for iri (prefer dcterms:title, fall back on rdfs:label)
        // todo: do we need to cache this? or is that premature optimization?
        const labels: Quad_Object[] = [];
        [PREDICATE_DCTERMS_TITLE, PREDICATE_RDFS_LABEL].forEach(predicate => {
            labels.push(...this.#rdfStore.getObjectsForSubjectAndPredicate(iri, predicate));
        });
        const languageTag = "@" + language;
        for (const labelCandidate of labels) {
            if (labelCandidate.id.endsWith(languageTag) || !labelCandidate.id.includes("@")) {
                label = labelCandidate.id.replaceAll("\"", "").replaceAll(languageTag, "");
                // break on first match
                break;
            }
        }
        // if all else fails, fall back on iri representation
        if (label === iri) {
            label = `<${iri}>`;
        }
        return label;
    }

    /**
     * Creates a clickable HTML element for an IRI. Human readable link text is obtained
     * from RDF statements if available. Known prefixes are substituted in the element
     * title which appears on mouse-hover, for improved readability.
     * Automatically distinguishes between cross-origin and same-origin IRIs.
     */
    #createElementIRI(iri:string, ...classes: string[]): HTMLAnchorElement {
        const labelIri = iri;
        let navigationIri = iri;
        let navigationTarget = "_blank";
        // handle same-origin navigation
        if (this.#relatedResourceIris.includes(iri)) {
            // highlight the element via css class
            classes.push(CLASS_NAVIGATION_RESOURCE);
            // convert href for same-origin navigation with the term.id as url param
            const location = new URL(window.location.toString());
            location.searchParams.set(PARAM_NAVIGATION_URL, iri);
            navigationIri = location.href;
            navigationTarget = "_self";
        }
        // create element
        const iriElement = document.createElement("a");
        iriElement.href = navigationIri;
        iriElement.textContent = this.#getLabel(labelIri);
        iriElement.title = this.#withPrefixes(labelIri);
        iriElement.target = navigationTarget;
        if (classes && classes.length) {
            iriElement.classList.add(...classes);
        }
        return iriElement;
    }

    /** Creates an HTML element for a fancy clickable title */
    #createElementForSubjectTitle(iri: string): HTMLDivElement {
        const titleElement = document.createElement("div");
        titleElement.classList.add(CLASS_TITLE);
        titleElement.appendChild(this.#createElementIRI(iri, CLASS_SUBJECT_TITLE));
        return titleElement;
    }

    /**
     * Creates an HTML element representing an RDF term (subject, predicate, or object)
     */
    #createElementForTerm(term: Term): HTMLSpanElement {
        let termElement;
        if (term.termType === "Literal") {
            termElement = document.createElement("span");
            termElement.textContent = this.#withPrefixes(term.id);
        } else {
            const elementClasses: string[] = [];
            termElement = this.#createElementIRI(term.id, ...elementClasses);
        }
        termElement.classList.add(CLASS_RDF_TERM);
        return termElement;
    }

    /**
     * Creates an HTML element containing a single RDF statement,
     * consisting of RDF terms <subject> <predicate> <object>.
     */
    #createElementForStatement(quad: Quad) {
        let statementElement = document.createElement("div");
        statementElement.classList.add(CLASS_RDF_STATEMENT);
        // as const to let typescript know the values are valid properties of Quad
        for (const termName of ["subject", "predicate", "object"] as const) {
            const element = this.#createElementForTerm(quad[termName]);
            element.classList.add("rdf-" + termName);
            statementElement.appendChild(element);
        }
        return statementElement;
    }

    /**
     * Creates an HTML element containing all RDF statements for the given RDF subject
     */
    #createElementForSubject(url: string, subject:Quad_Subject): HTMLDivElement {
        const subjectElement = document.createElement("div");
        subjectElement.classList.add(CLASS_SUBJECT);
        subjectElement.id = subject.id;
        subjectElement.appendChild(this.#createElementForSubjectTitle(subject.id));
        this.#rdfStore.getQuadsForGraphSubject(url, subject).forEach(quad => {
            subjectElement.appendChild(this.#createElementForStatement(quad));
        });
        return subjectElement;
    }

    /** Creates an HTML element for a prefix that triggers harvesting on click */
    #createElementForPrefix(prefix: string, uri:string): HTMLDivElement {
        const prefixElement = document.createElement("div");
        prefixElement.classList.add(CLASS_PREFIX);
        prefixElement.textContent = prefix;
        prefixElement.title = uri;
        if (this.#rdfStore.graphExists(uri)) {
            prefixElement.classList.add(CLASS_PREFIX_HARVESTED);
        } else {
            prefixElement.classList.add(CLASS_CLICKABLE);
            prefixElement.addEventListener("click", this.#prefixCallback.bind(this));
        }
        return prefixElement;
    }

    /** Creates an HTML element that contains links for all the prefixes */
    #createElementForPrefixes(): HTMLDivElement {
        const prefixesElement = document.createElement("div");
        prefixesElement.classList.add(CLASS_PREFIXES);
        const titleElement = document.createElement("div");
        titleElement.classList.add(CLASS_TITLE);
        titleElement.textContent = "Prefixes";
        prefixesElement.appendChild(titleElement);
        // sort prefixes
        const prefixEntries = Object.entries(this.#rdfStore.getPrefixes());
        prefixEntries.sort((a, b) => a[0].localeCompare(b[0]));
        // add prefixes to list element (for flex layout)
        const prefixListElement = document.createElement("div");
        prefixListElement.classList.add(CLASS_PREFIX_LIST);
        for (const [prefix, uri] of prefixEntries) {
            if (prefix) {
                prefixListElement.appendChild(this.#createElementForPrefix(prefix, uri));
            }
        }
        prefixesElement.appendChild(prefixListElement);
        return prefixesElement;
    }

    /**
     * Populates the content container based on statements from the RDF store about
     * the specified resource. The container is cleared first.
     */
    async #populate(url: string): Promise<void> {
        // clear
        this.#container.replaceChildren();
        // show prefixes
        this.#container.appendChild(this.#createElementForPrefixes());
        // iterate over all rdf subjects from the graph for the specified resource url
        this.#rdfStore.getSubjectsForGraph(url).forEach(subject => {
            this.#container.appendChild(this.#createElementForSubject(url, subject));
        });
    }

    /**
     * Updates the RdfStore based on the RDF turtle representation harvested from the
     * specified URL. Each resource representation is stored in its own graph,
     * identified by the resource url.
     */
    async #harvest(url: string): Promise<void> {
        if (this.#rdfStore.graphExists(url)) {
            console.debug("skipping %s because it has already been harvested", url)
            return;
        }
        // workaround: if the url represents a known prefix it is replaced to prevent
        // CORS and/or XML parsing issues
        const turtle = await this.#requestTurtle(this.#rdfStore.workaroundPrefixUri(url));
        await this.#rdfStore.parseTurtle(turtle, url);
    }

    /** Executes an HTTP GET request for RDF turtle and returns the response body as text */
    async #requestTurtle(url: string): Promise<string> {
        // enforce https
        url = url.replace("http://", "https://");
        // specify options to get rdf-turtle
        const options = {
            method: "GET",
            headers: {"accept": MEDIATYPE_TURTLE},
        };
        // generic fetch request
        console.debug("fetching %s from %s", options.headers.accept, url);
        const response = await fetch(url, options);
        if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`);
        }
        console.debug("got success response from %s", url);
        return await response.text();
    }

    /** Triggers harvesting of the specified prefix URI */
    #prefixCallback(event: PointerEvent): void {
        const target: EventTarget | null = event.target;
        if (target instanceof HTMLElement) {
            // should we check that the event.target has prefix class?
            const prefix = target.textContent;
            const prefixUri = target.title;
            this.#harvest(prefixUri)
                .then(() => {
                    const searchParams = new URLSearchParams(window.location.search);
                    this.#update(searchParams.get(PARAM_NAVIGATION_URL))
                        .then(() => console.debug("updated prefix " + prefix));
                })
                .catch(() => target.classList.add(CLASS_PREFIX_FAILED));
        }
    }
}
