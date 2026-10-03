/** Fresnel rim shader for the forensic lens: clear in the centre, pink light at grazing angles. */
export const lensVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`

export const lensFragment = /* glsl */ `
  uniform vec3 uRim;
  uniform vec3 uCore;
  uniform float uTime;
  uniform float uEnergy;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float facing = clamp(dot(vNormal, vView), 0.0, 1.0);
    float fresnel = pow(1.0 - facing, 2.6);
    // slow band that travels over the surface, like light moving across glass
    float band = smoothstep(0.42, 0.5, sin(vNormal.y * 5.0 + uTime * (0.5 + uEnergy)) * 0.5 + 0.5) * 0.08;
    vec3 color = mix(uCore, uRim, fresnel);
    float alpha = fresnel * 0.85 + band * fresnel + 0.035;
    gl_FragColor = vec4(color, alpha);
  }
`
