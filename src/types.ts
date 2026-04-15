export interface MapBuild {
    version: string;
    downloadUrl: string;
    filename: string;
    size?: string;
}

export interface BuildMetadata {
    key: string;
    size: number;
    uploaded: string;
    md5sum?: string;
}

export interface SeaweedFSConfig {
    endpoint: string;
    accessKey: string;
    secretKey: string;
    bucket: string;
}
