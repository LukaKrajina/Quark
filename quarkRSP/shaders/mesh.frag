<<<<<<< HEAD
#version 450

layout(location = 0) in vec3 fragWorldPos;
layout(location = 1) in vec3 fragNormal;
layout(location = 2) in vec2 fragUV;
layout(location = 3) in vec3 fragColor;

layout(binding = 0) uniform UBO {
    mat4 mvp;
    mat4 model;
    vec3 lightDir;
    float lightIntensity;
    vec3 camPos;
    float _pad0;
    vec3 baseColor;
    float metallic;
    float roughness;
    float useTexture;
} ubo;

layout(binding = 1) uniform sampler2D baseColorSampler;

layout(location = 0) out vec4 outColor;

const float PI = 3.14159265359;

float DistributionGGX(vec3 N, vec3 H, float roughness) {
    float a = roughness * roughness;
    float a2 = a * a;
    float NdotH = max(dot(N, H), 0.0);
    float denom = NdotH * NdotH * (a2 - 1.0) + 1.0;
    return a2 / (PI * denom * denom);
}

float GeometrySchlickGGX(float NdotV, float roughness) {
    float r = roughness + 1.0;
    float k = (r * r) / 8.0;
    return NdotV / (NdotV * (1.0 - k) + k);
}
float GeometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
    return GeometrySchlickGGX(max(dot(N, V), 0.0), roughness) *
           GeometrySchlickGGX(max(dot(N, L), 0.0), roughness);
}

vec3 FresnelSchlick(float cosTheta, vec3 F0) {
    return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}

void main() {
    vec3 N = normalize(fragNormal);
    vec3 V = normalize(ubo.camPos - fragWorldPos);
    vec3 L = normalize(-ubo.lightDir);
    vec3 H = normalize(V + L);

    // 材质基础色：有纹理则采样，否则用顶点色 * baseColor
    vec3 albedo;
    if (ubo.useTexture > 0.5) {
        albedo = texture(baseColorSampler, fragUV).rgb;
    } else {
        albedo = fragColor;
    }

    float metallic = ubo.metallic;
    float roughness = max(ubo.roughness, 0.04);

    vec3 F0 = mix(vec3(0.04), albedo, metallic);

    float NDF = DistributionGGX(N, H, roughness);
    float G = GeometrySmith(N, V, L, roughness);
    vec3 F = FresnelSchlick(max(dot(H, V), 0.0), F0);
    vec3 specular = (NDF * G * F) / (4.0 * max(dot(N, V), 0.0) * max(dot(N, L), 0.0) + 0.001);

    vec3 kD = (1.0 - F) * (1.0 - metallic);
    float NdotL = max(dot(N, L), 0.0);
    vec3 direct = (kD * albedo / PI + specular) * ubo.lightIntensity * NdotL;

    // 半球环境光：上半球（N.y>0）更亮，模拟天空漫反射 + 地面反弹
    float hemi = 0.5 + 0.5 * N.y;
    vec3 ambient = albedo * (0.18 + 0.22 * hemi);

    // 背面补光（法线背对光源时仍可见，避免死黑）
    float backLight = max(dot(N, -L), 0.0);
    vec3 rim = albedo * backLight * 0.15;

    vec3 color = ambient + direct + rim;

    color = color / (color + vec3(1.0));
    color = pow(color, vec3(1.0 / 2.2));
    outColor = vec4(color, 1.0);
}
=======
#version 450

layout(location = 0) in vec3 fragWorldPos;
layout(location = 1) in vec3 fragNormal;
layout(location = 2) in vec2 fragUV;
layout(location = 3) in vec3 fragColor;

layout(binding = 0) uniform UBO {
    vec3 lightDir;
    float lightIntensity;
    vec3 camPos;
    float darkMode;   // 0 = 白天, 1 = 夜间
    vec3 baseColor;
    float metallic;
    float roughness;
    float useTexture;
} ubo;

layout(location = 0) out vec4 outColor;

const float PI = 3.14159265359;

float DistributionGGX(vec3 N, vec3 H, float roughness) {
    float a = roughness * roughness;
    float a2 = a * a;
    float NdotH = max(dot(N, H), 0.0);
    float denom = NdotH * NdotH * (a2 - 1.0) + 1.0;
    return a2 / (PI * denom * denom);
}

float GeometrySchlickGGX(float NdotV, float roughness) {
    float r = roughness + 1.0;
    float k = (r * r) / 8.0;
    return NdotV / (NdotV * (1.0 - k) + k);
}
float GeometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
    return GeometrySchlickGGX(max(dot(N, V), 0.0), roughness) *
           GeometrySchlickGGX(max(dot(N, L), 0.0), roughness);
}

vec3 FresnelSchlick(float cosTheta, vec3 F0) {
    return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}

void main() {
    vec3 N = normalize(fragNormal);
    vec3 V = normalize(ubo.camPos - fragWorldPos);
    vec3 L = normalize(-ubo.lightDir);
    vec3 H = normalize(V + L);
    vec3 albedo = fragColor;

    float metallic = ubo.metallic;
    float roughness = max(ubo.roughness, 0.04);

    vec3 F0 = mix(vec3(0.04), albedo, metallic);

    float NDF = DistributionGGX(N, H, roughness);
    float G = GeometrySmith(N, V, L, roughness);
    vec3 F = FresnelSchlick(max(dot(H, V), 0.0), F0);
    vec3 specular = (NDF * G * F) / (4.0 * max(dot(N, V), 0.0) * max(dot(N, L), 0.0) + 0.001);

    vec3 kD = (1.0 - F) * (1.0 - metallic);
    float NdotL = max(dot(N, L), 0.0);
    vec3 direct = (kD * albedo / PI + specular) * ubo.lightIntensity * NdotL;

    float hemi = 0.5 + 0.5 * N.y;
    vec3 ambientDay = vec3(0.22, 0.22, 0.20);
    vec3 ambientNight = vec3(0.07, 0.09, 0.13);
    vec3 ambientColor = mix(ambientDay, ambientNight, ubo.darkMode);
    vec3 ambient = albedo * ambientColor * (1.0 + 0.9 * hemi);
    
    float backLight = max(dot(N, -L), 0.0);
    vec3 rim = albedo * backLight * 0.15;

    vec3 color = ambient + direct + rim;

    color = color / (color + vec3(1.0));
    color = pow(color, vec3(1.0 / 2.2));
    outColor = vec4(color, 1.0);
}
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
