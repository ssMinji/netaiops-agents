FROM public.ecr.aws/docker/library/python:3.12-slim
WORKDIR /app

COPY requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir --no-deps "awslabs.aws-network-mcp-server>=0.0.5"

ENV AWS_DEFAULT_REGION=us-east-1
ENV AWS_REGION=us-east-1

# MCP server configuration
ENV NETWORK_MCP_ALLOW_WRITE=false
ENV MCP_HOST=127.0.0.1
ENV MCP_PORT=8000

# Signal Docker container for host binding logic
ENV DOCKER_CONTAINER=1

# Create non-root user
RUN useradd -m -u 1000 mcp_server
USER mcp_server

COPY main.py main.py

EXPOSE 9000
EXPOSE 8000
EXPOSE 8080

CMD ["python", "main.py"]
