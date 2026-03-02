export interface Agent {
  id: string;
  name: string;
  icon: string;
  description: string;
  placeholder: string;
  scenarios: Scenario[];
  parentId?: string;
}

export interface Scenario {
  id: string;
  name: string;
  prompt: string;
}

export interface Model {
  id: string;
  name: string;
}

export interface MessageMetrics {
  ttfb_ms?: number;
  total_ms?: number;
  client_ttfb_ms?: number;
  client_total_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
  tools_used?: string[];
}

export interface Message {
  role: "user" | "assistant";
  content: string;
  metrics?: MessageMetrics;
}

export interface AppConfig {
  agents: Agent[];
  models: Model[];
  region: string;
}

// Dashboard types
export interface VpcInfo {
  id: string;
  cidr: string;
  name: string;
  state: string;
}

export interface Ec2Info {
  id: string;
  type: string;
  state: string;
  name: string;
  private_ip: string;
}

export interface LbInfo {
  name: string;
  type: string;
  scheme: string;
  state: string;
  dns: string;
}

export interface NatGwInfo {
  id: string;
  state: string;
  subnet: string;
  public_ip: string;
}

export interface DashboardData {
  vpcs: VpcInfo[];
  ec2_instances: Ec2Info[];
  load_balancers: LbInfo[];
  nat_gateways: NatGwInfo[];
  region: string;
  regions: string[];
  cached_at: number;
}
