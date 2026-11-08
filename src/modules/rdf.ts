// https://github.com/rdfjs/N3.js/ (repo)
// https://rdf.js.org/N3.js/ (docs)
// https://www.rubensworks.net/blog/2019/10/06/using-rdf-in-javascript/

import {
    DataFactory,
    Parser,
    Quad,
    type Quad_Object,
    type Quad_Predicate,
    type Quad_Subject,
    Store
} from "n3";

export const MEDIATYPE_TURTLE = "text/turtle";

const DCTERMS_IS_PART_OF = "http://purl.org/dc/terms/isPartOf";
const LDP_HASMEMBER_RELATION = "http://www.w3.org/ns/ldp#hasMemberRelation"
const PREFIX_URI_FDPO = "https://w3id.org/fdp/fdp-o#";

// map known prefix URIs to URLs that can be resolved from a browser (w.r.t. CORS, XML, etc.)
type PrefixMap = {[prefix: string]: string};
const KNOWN_PREFIX_MAP: PrefixMap = {
    "http://purl.org/dc/terms/": "https://www.dublincore.org/specifications/dublin-core/dcmi-terms/dublin_core_terms.ttl",
    [PREFIX_URI_FDPO]: "ontologies/fdp-o.ttl",  // only available as XML so use custom ttl
};

/** Maintains rdf store state */
export class RdfStore {
    #prefixes: PrefixMap;
    #store: Store;

    constructor() {
        // always add the fdp-o prefix
        this.#prefixes = {"fdp-o": PREFIX_URI_FDPO};
        this.#store = new Store();
    }

    /**
     * Parses an RDF turtle string into the triple store using the specified uri as
     * graph uri. Also updates the #prefixes object.
     */
    async parseTurtle(turtle: string, uri: string): Promise<void> {
        // return a promise so we can handle parsing errors properly
        return new Promise((resolve, reject) => {
            // use a dedicated graph for each parsed uri
            const graph = uri ? DataFactory.namedNode(uri) : DataFactory.defaultGraph();
            const turtleParser = new Parser({ format: MEDIATYPE_TURTLE });
            turtleParser.parse(turtle, (error, quad, prefixes) => {
                if (error) {
                    console.debug("failed to parse quad for %s:\n%s", uri, error);
                    reject(error);
                } else if (quad) {
                    const newQuad = DataFactory.quad(
                        quad.subject, quad.predicate, quad.object, graph
                    );
                    this.#store.add(newQuad);
                    console.debug("added to store: %s (graph: %s)", newQuad.subject.id, newQuad.graph.id);
                } else {
                    console.debug("done parsing %s", uri);
                    // update the class attribute
                    Object.assign(this.#prefixes, prefixes);
                    resolve();
                }
            });
        });
    }

    /**
     * Returns an array of IRIs representing parents and children of the specified
     * RDF subject. These represent navigation links. Note that we would ideally have a
     * single subjectIri argument, but we need to accept an array for the trailing slash
     * workaround.
     */
    getRelatedResourceIris(subjectIris: string[]): string[] {
        // todo: clean up the workaround mess
        // as a workaround for the possible trailing slash discrepancy between root
        // subject URI and base URI, we need to consider multiple URIs...
        // however, ideally we would only have to consider a single subject URI
        const childNavigationPredicates = [];
        for (const subjectIri of subjectIris) {
            // use the LDP statements to figure out which predicate links to children
            // (this relation is not defined on the subject itself, but on an LDP
            // container which is part of the graph identified by the current subject)
            childNavigationPredicates.push(...this.#store.getObjects(
                null,
                LDP_HASMEMBER_RELATION,
                DataFactory.namedNode(subjectIri),
            ));
        }
        // again the workaround for possible root trailing slash discrepancy
        const children = [];
        for (const subjectIri of subjectIris) {
            // there *should* be only one LDP hasMemberRelation per LDP container, but an
            // RDF document *could* define multiple LDP containers with different
            // hasMemberRelation objects, so we iterate over (possibly) multiple predicates
            for (const childNavigationPredicate of childNavigationPredicates) {
                const childUris = this.#store.getObjects(
                    DataFactory.namedNode(subjectIri),
                    childNavigationPredicate,
                    null,
                ).map(c => c.id);
                children.push(...childUris);
            }
        }
        // again the workaround for possible root trailing slash discrepancy
        const parents = [];
        for (const subjectIri of subjectIris) {
            parents.push(...this.#store.getObjects(
                DataFactory.namedNode(subjectIri),
                // LDP does not provide a way to specify the parent relation, so use dcterms
                DataFactory.namedNode(DCTERMS_IS_PART_OF),
                null,
            ).map(p => p.id));
        }
        console.info(parents)
        // unique array of IRIs from parents and children
        return [... new Set([...children, ...parents])];
    }

    /** Returns true if the specified graph exists */
    graphExists(graphUri: string): boolean {
        return this.#store.has(null, null, null, DataFactory.namedNode(graphUri));
    }

    /**
     * Gets all RDF subjects from the specified resource's graph.
     */
    getSubjectsForGraph(graphUri: string): Quad_Subject[] {
        return this.#store.getSubjects(null, null, DataFactory.namedNode(graphUri));
    }

    /**
     * Returns all RDF quads from the specified resource's graph matching the subject.
     */
    getQuadsForGraphSubject(graphUri: string, subject: Quad_Subject): Quad[] {
        return this.#store.getQuads(subject, null, null, DataFactory.namedNode(graphUri));
    }

    /** Returns all RDF objects matching the subject and predicate, from all graphs */
    getObjectsForSubjectAndPredicate(subject: Quad_Subject | string, predicate: Quad_Predicate | string): Quad_Object[] {
        return this.#store.getObjects(subject, predicate, null);
    }

    /** Returns known prefixes (populated via parser) */
    getPrefixes(): PrefixMap {
        return this.#prefixes;
    }

    /**
     * Returns a prefix URI that resolves to a turtle document, if available. Otherwise
     * just returns the input URI. This is a crappy workaround for the fact that many
     * ontologies are not properly configured for CORS and some are only available in
     * XML, which cannot be parsed by our n3.js.
     */
    workaroundPrefixUri(uri: string): string {
        const workaroundUri = KNOWN_PREFIX_MAP[uri] || uri;
        if (workaroundUri !== uri) console.info("using prefix workaround for " + uri);
        return workaroundUri;
    }
}
