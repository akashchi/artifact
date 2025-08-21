"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadArtifactInternal = exports.downloadArtifactPublic = exports.streamExtractExternal = void 0;
const promises_1 = __importDefault(require("fs/promises"));
const crypto = __importStar(require("crypto"));
const stream = __importStar(require("stream"));
const github = __importStar(require("@actions/github"));
const core = __importStar(require("@actions/core"));
const httpClient = __importStar(require("@actions/http-client"));
const unzip_stream_1 = __importDefault(require("unzip-stream"));
const user_agent_1 = require("../shared/user-agent");
const config_1 = require("../shared/config");
const artifact_twirp_client_1 = require("../shared/artifact-twirp-client");
const generated_1 = require("../../generated");
const util_1 = require("../shared/util");
const errors_1 = require("../shared/errors");
const scrubQueryParameters = (url) => {
    const parsed = new URL(url);
    parsed.search = '';
    return parsed.toString();
};
function exists(path) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield promises_1.default.access(path);
            return true;
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                return false;
            }
            else {
                throw error;
            }
        }
    });
}
function streamExtract(url, directory) {
    return __awaiter(this, void 0, void 0, function* () {
        core.info(`Starting streamExtract for URL: ${scrubQueryParameters(url)}`);
        core.info(`Target directory: ${directory}`);
        let retryCount = 0;
        while (retryCount < 5) {
            try {
                core.info(`Attempt ${retryCount + 1}/5 to download and extract artifact`);
                const result = yield streamExtractExternal(url, directory);
                core.info(`StreamExtract completed successfully on attempt ${retryCount + 1}`);
                return result;
            }
            catch (error) {
                retryCount++;
                core.warning(`Failed to download artifact after ${retryCount} retries due to ${error.message}. Retrying in 5 seconds...`);
                core.debug(`Error details: ${error.stack}`);
                // wait 5 seconds before retrying
                yield new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
        const errorMessage = `Artifact download failed after ${retryCount} retries.`;
        core.error(errorMessage);
        throw new Error(errorMessage);
    });
}
function streamExtractExternal(url, directory) {
    return __awaiter(this, void 0, void 0, function* () {
        core.info(`Initializing HTTP client for artifact download`);
        const client = new httpClient.HttpClient((0, user_agent_1.getUserAgentString)());
        core.info(`Making HTTP GET request to blob storage`);
        const response = yield client.get(url);
        core.info(`HTTP response received with status: ${response.message.statusCode}`);
        if (response.message.statusCode !== 200) {
            const errorMessage = `Unexpected HTTP response from blob storage: ${response.message.statusCode} ${response.message.statusMessage}`;
            core.error(errorMessage);
            throw new Error(errorMessage);
        }
        const timeout = 30 * 1000; // 30 seconds
        core.debug(`Setting timeout for blob storage chunks: ${timeout}ms`);
        let sha256Digest = undefined;
        return new Promise((resolve, reject) => {
            const timerFn = () => {
                core.error(`Timeout reached: Blob storage chunk did not respond in ${timeout}ms`);
                response.message.destroy(new Error(`Blob storage chunk did not respond in ${timeout}ms`));
            };
            let timer = setTimeout(timerFn, timeout);
            core.info(`Creating hash stream for SHA256 verification`);
            const hashStream = crypto.createHash('sha256').setEncoding('hex');
            const passThrough = new stream.PassThrough();
            core.info(`Setting up stream pipeline for download and extraction`);
            response.message.pipe(passThrough);
            passThrough.pipe(hashStream);
            const extractStream = passThrough;
            let dataChunksReceived = 0;
            extractStream
                .on('data', (chunk) => {
                dataChunksReceived++;
                if (dataChunksReceived % 100 === 0) {
                    core.debug(`Received ${dataChunksReceived} data chunks (chunk size: ${chunk.length} bytes)`);
                }
                clearTimeout(timer);
                timer = setTimeout(timerFn, timeout);
            })
                .on('error', (error) => {
                core.error(`Stream error during artifact download: ${error.message}`);
                core.debug(`Stream error stack trace: ${error.stack}`);
                clearTimeout(timer);
                reject(error);
            })
                .pipe(unzip_stream_1.default.Extract({ path: directory }))
                .on('close', () => {
                core.info(`Extraction completed successfully`);
                core.info(`Total data chunks received: ${dataChunksReceived}`);
                clearTimeout(timer);
                if (hashStream) {
                    hashStream.end();
                    sha256Digest = hashStream.read();
                    core.info(`SHA256 digest of downloaded artifact is ${sha256Digest}`);
                }
                resolve({ sha256Digest: `sha256:${sha256Digest}` });
            })
                .on('error', (error) => {
                core.error(`Extraction error: ${error.message}`);
                core.debug(`Extraction error stack trace: ${error.stack}`);
                clearTimeout(timer);
                reject(error);
            });
        });
    });
}
exports.streamExtractExternal = streamExtractExternal;
function downloadArtifactPublic(artifactId, repositoryOwner, repositoryName, token, options) {
    return __awaiter(this, void 0, void 0, function* () {
        core.info(`Starting public artifact download`);
        core.info(`Artifact ID: ${artifactId}`);
        core.info(`Repository: ${repositoryOwner}/${repositoryName}`);
        core.info(`Options: ${JSON.stringify(options || {})}`);
        const downloadPath = yield resolveOrCreateDirectory(options === null || options === void 0 ? void 0 : options.path);
        core.info(`Download path resolved to: ${downloadPath}`);
        core.info(`Initializing GitHub API client`);
        const api = github.getOctokit(token);
        let digestMismatch = false;
        core.info(`Downloading artifact '${artifactId}' from '${repositoryOwner}/${repositoryName}'`);
        core.info(`Making API call to download artifact`);
        const { headers, status } = yield api.rest.actions.downloadArtifact({
            owner: repositoryOwner,
            repo: repositoryName,
            artifact_id: artifactId,
            archive_format: 'zip',
            request: {
                redirect: 'manual'
            }
        });
        core.info(`API response status: ${status}`);
        core.debug(`Response headers: ${JSON.stringify(headers)}`);
        if (status !== 302) {
            const errorMessage = `Unable to download artifact. Unexpected status: ${status}`;
            core.error(errorMessage);
            throw new Error(errorMessage);
        }
        const { location } = headers;
        if (!location) {
            const errorMessage = `Unable to redirect to artifact download url`;
            core.error(errorMessage);
            core.debug(`Headers received: ${JSON.stringify(headers)}`);
            throw new Error(errorMessage);
        }
        core.info(`Redirecting to blob download url: ${scrubQueryParameters(location)}`);
        try {
            core.info(`Starting download of artifact to: ${downloadPath}`);
            const extractResponse = yield streamExtract(location, downloadPath);
            core.info(`Artifact download completed successfully.`);
            core.info(`Final SHA256 digest: ${extractResponse.sha256Digest}`);
            if (options === null || options === void 0 ? void 0 : options.expectedHash) {
                core.info(`Verifying artifact integrity`);
                core.info(`Expected hash: ${options.expectedHash}`);
                core.info(`Computed hash: ${extractResponse.sha256Digest}`);
                if ((options === null || options === void 0 ? void 0 : options.expectedHash) !== extractResponse.sha256Digest) {
                    digestMismatch = true;
                    core.warning(`Digest mismatch detected!`);
                    core.debug(`Computed digest: ${extractResponse.sha256Digest}`);
                    core.debug(`Expected digest: ${options.expectedHash}`);
                }
                else {
                    core.info(`Artifact integrity verification passed`);
                }
            }
            else {
                core.debug(`No expected hash provided, skipping integrity verification`);
            }
        }
        catch (error) {
            const errorMessage = `Unable to download and extract artifact: ${error.message}`;
            core.error(errorMessage);
            core.debug(`Download error stack trace: ${error.stack}`);
            throw new Error(errorMessage);
        }
        core.info(`Download operation completed. Digest mismatch: ${digestMismatch}`);
        return { downloadPath, digestMismatch };
    });
}
exports.downloadArtifactPublic = downloadArtifactPublic;
function downloadArtifactInternal(artifactId, options) {
    return __awaiter(this, void 0, void 0, function* () {
        core.info(`Starting internal artifact download`);
        core.info(`Artifact ID: ${artifactId}`);
        core.info(`Options: ${JSON.stringify(options || {})}`);
        const downloadPath = yield resolveOrCreateDirectory(options === null || options === void 0 ? void 0 : options.path);
        core.info(`Download path resolved to: ${downloadPath}`);
        core.info(`Initializing internal artifact client`);
        const artifactClient = (0, artifact_twirp_client_1.internalArtifactTwirpClient)();
        let digestMismatch = false;
        core.info(`Getting backend IDs from token`);
        const { workflowRunBackendId, workflowJobRunBackendId } = (0, util_1.getBackendIdsFromToken)();
        core.debug(`Workflow run backend ID: ${workflowRunBackendId}`);
        core.debug(`Workflow job run backend ID: ${workflowJobRunBackendId}`);
        const listReq = {
            workflowRunBackendId,
            workflowJobRunBackendId,
            idFilter: generated_1.Int64Value.create({ value: artifactId.toString() })
        };
        core.info(`Listing artifacts with filter for ID: ${artifactId}`);
        const { artifacts } = yield artifactClient.ListArtifacts(listReq);
        core.info(`Found ${artifacts.length} artifacts matching the filter`);
        if (artifacts.length === 0) {
            const errorMessage = `No artifacts found for ID: ${artifactId}\nAre you trying to download from a different run? Try specifying a github-token with \`actions:read\` scope.`;
            core.error(errorMessage);
            throw new errors_1.ArtifactNotFoundError(errorMessage);
        }
        if (artifacts.length > 1) {
            core.warning('Multiple artifacts found, defaulting to first.');
            core.debug(`Artifacts found: ${artifacts.map(a => `${a.name} (ID: ${a.databaseId})`).join(', ')}`);
        }
        const selectedArtifact = artifacts[0];
        core.info(`Selected artifact: ${selectedArtifact.name}`);
        core.debug(`Artifact details: ${JSON.stringify({
            name: selectedArtifact.name,
            databaseId: selectedArtifact.databaseId,
            workflowRunBackendId: selectedArtifact.workflowRunBackendId,
            workflowJobRunBackendId: selectedArtifact.workflowJobRunBackendId
        })}`);
        const signedReq = {
            workflowRunBackendId: selectedArtifact.workflowRunBackendId,
            workflowJobRunBackendId: selectedArtifact.workflowJobRunBackendId,
            name: selectedArtifact.name
        };
        core.info(`Requesting signed URL for artifact: ${selectedArtifact.name}`);
        const { signedUrl } = yield artifactClient.GetSignedArtifactURL(signedReq);
        core.info(`Redirecting to blob download url: ${scrubQueryParameters(signedUrl)}`);
        try {
            core.info(`Starting download of artifact to: ${downloadPath}`);
            const extractResponse = yield streamExtract(signedUrl, downloadPath);
            core.info(`Artifact download completed successfully.`);
            core.info(`Final SHA256 digest: ${extractResponse.sha256Digest}`);
            if (options === null || options === void 0 ? void 0 : options.expectedHash) {
                core.info(`Verifying artifact integrity`);
                core.info(`Expected hash: ${options.expectedHash}`);
                core.info(`Computed hash: ${extractResponse.sha256Digest}`);
                if ((options === null || options === void 0 ? void 0 : options.expectedHash) !== extractResponse.sha256Digest) {
                    digestMismatch = true;
                    core.warning(`Digest mismatch detected!`);
                    core.debug(`Computed digest: ${extractResponse.sha256Digest}`);
                    core.debug(`Expected digest: ${options.expectedHash}`);
                }
                else {
                    core.info(`Artifact integrity verification passed`);
                }
            }
            else {
                core.debug(`No expected hash provided, skipping integrity verification`);
            }
        }
        catch (error) {
            const errorMessage = `Unable to download and extract artifact: ${error.message}`;
            core.error(errorMessage);
            core.debug(`Download error stack trace: ${error.stack}`);
            throw new Error(errorMessage);
        }
        core.info(`Download operation completed. Digest mismatch: ${digestMismatch}`);
        return { downloadPath, digestMismatch };
    });
}
exports.downloadArtifactInternal = downloadArtifactInternal;
function resolveOrCreateDirectory(downloadPath = (0, config_1.getGitHubWorkspaceDir)()) {
    return __awaiter(this, void 0, void 0, function* () {
        core.info(`Resolving download directory: ${downloadPath}`);
        if (!(yield exists(downloadPath))) {
            core.info(`Artifact destination folder does not exist, creating: ${downloadPath}`);
            yield promises_1.default.mkdir(downloadPath, { recursive: true });
            core.info(`Successfully created directory: ${downloadPath}`);
        }
        else {
            core.debug(`Artifact destination folder already exists: ${downloadPath}`);
        }
        core.info(`Download directory resolved: ${downloadPath}`);
        return downloadPath;
    });
}
//# sourceMappingURL=download-artifact.js.map